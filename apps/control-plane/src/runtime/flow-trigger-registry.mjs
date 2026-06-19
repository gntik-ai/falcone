// Flow trigger registry (change: add-flows-triggers).
//
// The SINGLE place that converts a published flow's trigger declarations into ACTIVE listeners and
// translates external stimuli (cron fire, inbound webhook, platform event) into a
// StartWorkflowExecution. It is injected into flow-executor.mjs alongside the Temporal client so
// Temporal Schedule + Kafka SDK usage stays in one boundary (design.md D1).
//
// Three trigger surfaces, ONE invariant: tenant context is injected by the platform, NEVER
// accepted from an external caller.
//
//   cron           -> Temporal Schedule, id `{tenantId}:{workspaceId}:{flowId}` (design.md D2).
//                     The tenant + workspace are structurally encoded in the id so no schedule can
//                     be addressed across tenant boundaries. Overlap policy + catch-up window are
//                     taken verbatim from the DSL trigger options.
//   webhook        -> per-trigger HMAC secret (generateSigningSecret + encryptSecret), stored in
//                     flow_trigger_secrets keyed by (trigger_id, tenant_id, workspace_id). The
//                     webhook route loads + verifies it before any Temporal call (route handler in
//                     server.mjs). The secret is returned ONCE at publish.
//   platform-event -> a flow_trigger_registrations row keyed by the structural topic ref; a single
//                     Kafka consumer group subscribes to the union of registered physical topics
//                     and starts the bound flow on each match (design.md D5). Topic names embed
//                     tenantId/workspaceId, so cross-tenant fan-out is structurally impossible.
//
// Relation to services/scheduling-engine: flows use Temporal Schedules NATIVELY. The
// scheduling-engine standalone job table (scheduled_jobs) is NEVER touched here — the two
// subsystems are disjoint and a cron expression never fires twice from both (spec requirement).
//
// Storage backend mirrors flow-executor.mjs: with a `pool` it is Postgres-backed (RLS under
// falcone_app); with no pool it is an in-memory Map fallback (no-DB black-box mode). Temporal is a
// lazy gateway and may be injected directly (tests) to bypass a real connection.

import { randomUUID } from 'node:crypto';
import {
  generateSigningSecret,
  encryptSecret,
  decryptSecret,
  verifyIncomingWebhook,
} from '../../../../services/webhook-engine/src/webhook-signing.mjs';
import { clientError } from './errors.mjs';

const WORKFLOW_TYPE = 'DslInterpreterWorkflow';

// Map the three DSL trigger kinds (flow-definition.json: cron | webhook | platform-event) to the
// internal trigger_type discriminator stored in flow_trigger_registrations (DB CHECK uses
// underscores; the search-attribute / audit value matches).
export const TRIGGER_TYPES = Object.freeze({
  CRON: 'cron',
  WEBHOOK: 'webhook',
  PLATFORM_EVENT: 'platform_event',
  MANUAL: 'manual',
});

// Default Temporal Schedule overlap policy + catch-up window when the DSL trigger omits them.
// `skip` is the safe default for idempotent scheduled flows (no overlapping runs).
const DEFAULT_OVERLAP = 'skip';
const DEFAULT_CATCHUP_WINDOW = '1m';

// The Temporal SDK's ScheduleOverlapPolicy is an UPPERCASE enum
// (SKIP | BUFFER_ONE | BUFFER_ALL | CANCEL_OTHER | TERMINATE_OTHER | ALLOW_ALL); the DSL trigger
// options use friendly lowercase names. Map them here so `client.schedule.create` does not reject
// the value (`ValueError: Invalid enum value`). Unknown values fall back to the safe SKIP default.
const OVERLAP_POLICY_MAP = Object.freeze({
  skip: 'SKIP',
  allow: 'ALLOW_ALL',
  allow_all: 'ALLOW_ALL',
  buffer: 'BUFFER_ONE',
  buffer_one: 'BUFFER_ONE',
  buffer_all: 'BUFFER_ALL',
  cancel_other: 'CANCEL_OTHER',
  terminate_other: 'TERMINATE_OTHER',
});

function mapOverlapPolicy(value) {
  if (typeof value !== 'string') return 'SKIP';
  const upper = value.toUpperCase();
  if (Object.values(OVERLAP_POLICY_MAP).includes(upper)) return upper; // already an SDK enum value
  return OVERLAP_POLICY_MAP[value.toLowerCase()] ?? 'SKIP';
}

// ---------------------------------------------------------------------------------------------
// Trigger-def normalisation. The DSL (flow-definition.json) exposes each trigger as
// `{ kind, schedule?, path?, eventType?, options? }`. A stable per-trigger id is derived so the
// schedule id / secret row / registration row are addressable across publishes. The id is
// `{flowId}:{kind}:{discriminator}` so re-publishing the SAME trigger reuses the SAME id (the
// version swap upserts in place rather than orphaning).
// ---------------------------------------------------------------------------------------------

export function triggerIdFor(flowId, trigger) {
  const kind = trigger?.kind;
  if (kind === 'cron') return `${flowId}:cron:${trigger.schedule ?? 'default'}`;
  if (kind === 'webhook') return `${flowId}:webhook:${trigger.path ?? 'default'}`;
  if (kind === 'platform-event') return `${flowId}:platform-event:${trigger.eventType ?? 'default'}`;
  return `${flowId}:${kind ?? 'unknown'}`;
}

function normaliseTriggerType(kind) {
  if (kind === 'cron') return TRIGGER_TYPES.CRON;
  if (kind === 'webhook') return TRIGGER_TYPES.WEBHOOK;
  if (kind === 'platform-event') return TRIGGER_TYPES.PLATFORM_EVENT;
  return null;
}

// The Temporal Schedule id for a flow's cron trigger. Structural tenant isolation (design.md D2):
// tenant + workspace are the leading segments so a foreign prefix is unaddressable.
export function scheduleIdFor(tenantId, workspaceId, flowId) {
  return `${tenantId}:${workspaceId}:${flowId}`;
}

// The structural physical topic a platform-event trigger subscribes to. Reuses the exact naming
// the producers emit (events-executor::physicalTopic / CDC bridge deriveTopic) so the consumer
// only ever subscribes to the tenant's own topics — the SOLE cross-tenant isolation mechanism.
export function physicalTopicForTrigger(tenantId, workspaceId, trigger) {
  const eventType = trigger?.eventType ?? '';
  if (eventType === 'pg-changes') return `${tenantId}.${workspaceId}.pg-changes`;
  if (eventType === 'mongo-changes') return `${tenantId}.${workspaceId}.mongo-changes`;
  // Default: a workspace events topic (evt.{workspaceId}.{eventType}).
  return `evt.${workspaceId}.${eventType}`;
}

// ---------------------------------------------------------------------------------------------
// Secret + registration store. Postgres-backed with a pool; in-memory Map otherwise.
// Tenant + workspace are ALWAYS taken from the verified identity, never from a request body.
// ---------------------------------------------------------------------------------------------

export function createTriggerStore({ pool } = {}) {
  return pool ? createPostgresTriggerStore(pool) : createInMemoryTriggerStore();
}

function createInMemoryTriggerStore() {
  // secrets key: `${tenantId} ${workspaceId} ${triggerId}` -> { row }
  const secrets = new Map();
  // registrations key: same shape -> { row }
  const regs = new Map();
  const key = (t, w, id) => `${t} ${w} ${id}`;

  return {
    async ensureSchema() { /* no-op */ },

    async upsertSecret({ tenantId, workspaceId, flowId, triggerId, cipher, iv }) {
      const k = key(tenantId, workspaceId, triggerId);
      const row = {
        id: secrets.get(k)?.id ?? randomUUID(),
        trigger_id: triggerId, flow_id: flowId, tenant_id: tenantId, workspace_id: workspaceId,
        cipher, iv, status: 'active', created_at: new Date().toISOString(),
      };
      secrets.set(k, row);
      return row;
    },

    async getSecret({ tenantId, workspaceId, triggerId }) {
      const row = secrets.get(key(tenantId, workspaceId, triggerId));
      // Cross-tenant lookup returns nothing: the composite key embeds the tenant, so a foreign
      // tenantId never matches a row stored under tenant A.
      return row && row.status === 'active' ? row : null;
    },

    async revokeSecretsForFlow({ tenantId, workspaceId, flowId }) {
      let revoked = 0;
      for (const row of secrets.values()) {
        if (row.tenant_id === tenantId && row.workspace_id === workspaceId && row.flow_id === flowId && row.status === 'active') {
          row.status = 'revoked';
          revoked += 1;
        }
      }
      return { revoked };
    },

    async upsertRegistration({ tenantId, workspaceId, flowId, version, triggerId, triggerType, triggerDef, topicRef }) {
      const k = key(tenantId, workspaceId, triggerId);
      const row = {
        id: regs.get(k)?.id ?? randomUUID(),
        flow_id: flowId, version, trigger_id: triggerId, trigger_type: triggerType,
        trigger_def: triggerDef, topic_ref: topicRef ?? null,
        tenant_id: tenantId, workspace_id: workspaceId,
        created_at: regs.get(k)?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      regs.set(k, row);
      return row;
    },

    async deleteRegistrationsForFlow({ tenantId, workspaceId, flowId }) {
      let removed = 0;
      for (const [k, row] of regs.entries()) {
        if (row.tenant_id === tenantId && row.workspace_id === workspaceId && row.flow_id === flowId) {
          regs.delete(k);
          removed += 1;
        }
      }
      return { removed };
    },

    async findRegistrationsByTopic({ topicRef }) {
      // Structural topic scope: the topicRef ALREADY embeds tenantId/workspaceId, so matching by
      // topicRef alone cannot cross tenants. We additionally filter by trigger_type for clarity.
      const out = [];
      for (const row of regs.values()) {
        if (row.trigger_type === TRIGGER_TYPES.PLATFORM_EVENT && row.topic_ref === topicRef) out.push(row);
      }
      return out;
    },

    async listEventTopics() {
      const topics = new Set();
      for (const row of regs.values()) {
        if (row.trigger_type === TRIGGER_TYPES.PLATFORM_EVENT && row.topic_ref) topics.add(row.topic_ref);
      }
      return [...topics];
    },

    async deleteAllForTenant({ tenantId }) {
      let removed = 0;
      for (const [k, row] of secrets.entries()) if (row.tenant_id === tenantId) { secrets.delete(k); removed += 1; }
      for (const [k, row] of regs.entries()) if (row.tenant_id === tenantId) { regs.delete(k); removed += 1; }
      return { removed };
    },
  };
}

function createPostgresTriggerStore(pool) {
  return {
    async ensureSchema() {
      // Authoritative schema + RLS live in the .sql migrations
      // (charts/in-falcone/bootstrap/migrations/20260612-005,-006). ensureSchema mirrors
      // flow-executor.mjs so a standalone metadata pool boots without the Helm migration job.
      await pool.query(`CREATE TABLE IF NOT EXISTS flow_trigger_secrets (
        id text NOT NULL DEFAULT gen_random_uuid()::text,
        trigger_id text NOT NULL,
        flow_id text NOT NULL,
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        cipher text NOT NULL,
        iv text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id),
        UNIQUE (trigger_id, tenant_id, workspace_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS flow_trigger_registrations (
        id text NOT NULL DEFAULT gen_random_uuid()::text,
        flow_id text NOT NULL,
        version integer NOT NULL,
        trigger_id text NOT NULL,
        trigger_type text NOT NULL,
        trigger_def jsonb NOT NULL DEFAULT '{}'::jsonb,
        topic_ref text,
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (id),
        UNIQUE (trigger_id, tenant_id, workspace_id)
      )`);
    },

    async upsertSecret({ tenantId, workspaceId, flowId, triggerId, cipher, iv }) {
      const res = await pool.query(
        `INSERT INTO flow_trigger_secrets (trigger_id, flow_id, tenant_id, workspace_id, cipher, iv, status)
           VALUES ($1,$2,$3,$4,$5,$6,'active')
         ON CONFLICT (trigger_id, tenant_id, workspace_id)
           DO UPDATE SET cipher = EXCLUDED.cipher, iv = EXCLUDED.iv, status = 'active'
         RETURNING *`,
        [triggerId, flowId, tenantId, workspaceId, cipher, iv],
      );
      return res.rows[0];
    },

    async getSecret({ tenantId, workspaceId, triggerId }) {
      const res = await pool.query(
        `SELECT * FROM flow_trigger_secrets
           WHERE trigger_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND status = 'active'`,
        [triggerId, tenantId, workspaceId],
      );
      return res.rows[0] ?? null;
    },

    async revokeSecretsForFlow({ tenantId, workspaceId, flowId }) {
      const res = await pool.query(
        `UPDATE flow_trigger_secrets SET status = 'revoked'
           WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 AND status = 'active'`,
        [tenantId, workspaceId, flowId],
      );
      return { revoked: res.rowCount ?? 0 };
    },

    async upsertRegistration({ tenantId, workspaceId, flowId, version, triggerId, triggerType, triggerDef, topicRef }) {
      const res = await pool.query(
        `INSERT INTO flow_trigger_registrations
           (flow_id, version, trigger_id, trigger_type, trigger_def, topic_ref, tenant_id, workspace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (trigger_id, tenant_id, workspace_id)
           DO UPDATE SET version = EXCLUDED.version, trigger_type = EXCLUDED.trigger_type,
                         trigger_def = EXCLUDED.trigger_def, topic_ref = EXCLUDED.topic_ref,
                         updated_at = now()
         RETURNING *`,
        [flowId, version, triggerId, triggerType, triggerDef ?? {}, topicRef ?? null, tenantId, workspaceId],
      );
      return res.rows[0];
    },

    async deleteRegistrationsForFlow({ tenantId, workspaceId, flowId }) {
      const res = await pool.query(
        `DELETE FROM flow_trigger_registrations WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3`,
        [tenantId, workspaceId, flowId],
      );
      return { removed: res.rowCount ?? 0 };
    },

    async findRegistrationsByTopic({ topicRef }) {
      const res = await pool.query(
        `SELECT * FROM flow_trigger_registrations
           WHERE trigger_type = 'platform_event' AND topic_ref = $1`,
        [topicRef],
      );
      return res.rows;
    },

    async listEventTopics() {
      const res = await pool.query(
        `SELECT DISTINCT topic_ref FROM flow_trigger_registrations
           WHERE trigger_type = 'platform_event' AND topic_ref IS NOT NULL`,
      );
      return res.rows.map((r) => r.topic_ref);
    },

    async deleteAllForTenant({ tenantId }) {
      const s = await pool.query(`DELETE FROM flow_trigger_secrets WHERE tenant_id = $1`, [tenantId]);
      const r = await pool.query(`DELETE FROM flow_trigger_registrations WHERE tenant_id = $1`, [tenantId]);
      return { removed: (s.rowCount ?? 0) + (r.rowCount ?? 0) };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Temporal Schedule gateway. Lazy-connect; a `scheduleClient` (from an injected Temporal client's
// `.schedule`) may be supplied directly in tests. Mirrors flow-executor's gateway.
// ---------------------------------------------------------------------------------------------

function createScheduleGateway({ temporalClient, getTemporalClient, logger }) {
  async function client() {
    if (temporalClient) return temporalClient;
    if (getTemporalClient) return getTemporalClient();
    throw clientError('Temporal is not configured', 503, 'TEMPORAL_UNAVAILABLE');
  }

  async function upsertSchedule({ scheduleId, cronExpression, overlap, catchupWindow, taskQueue, args, searchAttributes }) {
    const c = await client();
    const action = {
      type: 'startWorkflow',
      workflowType: WORKFLOW_TYPE,
      taskQueue,
      args: args ?? [],
      searchAttributes,
    };
    const spec = { cronExpressions: [cronExpression] };
    const policies = { overlap, catchupWindow };
    try {
      await c.schedule.create({ scheduleId, spec, action, policies });
      return { created: true };
    } catch (err) {
      // A schedule with this id already exists -> update it in place (preserves the schedule, swaps
      // the action target / spec) so there is no firing gap during a version swap (design.md D6).
      const handle = c.schedule.getHandle(scheduleId);
      await handle.update((prev) => ({
        ...prev,
        spec,
        action,
        policies: { ...(prev.policies ?? {}), ...policies },
      }));
      return { created: false, updated: true };
    }
  }

  async function deleteSchedule({ scheduleId }) {
    const c = await client();
    try {
      await c.schedule.getHandle(scheduleId).delete();
      return { deleted: true };
    } catch (err) {
      // Already absent -> idempotent no-op (no orphaned schedule remains, the spec invariant).
      logger?.error?.('[flow-trigger-registry] schedule delete (already absent?):', err?.message ?? err);
      return { deleted: false };
    }
  }

  return { upsertSchedule, deleteSchedule };
}

// ---------------------------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------------------------

// The master key used to AES-256-GCM-encrypt per-trigger webhook HMAC secrets at rest. A real key
// MUST be supplied via FLOW_TRIGGER_SECRET_KEY (or injected). When it is absent we FAIL CLOSED in
// production — returning null so trigger-secret operations are refused — instead of silently
// encrypting with a publicly-known constant; only a non-production profile falls back to the
// well-known dev key so local/test runs keep working (#636).
const DEV_TRIGGER_SECRET_KEY = 'flow-trigger-dev-master-key';
export function resolveTriggerSecretKey() {
  const configured = process.env.FLOW_TRIGGER_SECRET_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return null;
  return DEV_TRIGGER_SECRET_KEY;
}

export function createFlowTriggerRegistry({
  store = createTriggerStore(),
  // Injected Temporal client (its `.schedule` is the ScheduleClient) OR a lazy getter shared with
  // the flow executor's gateway.
  temporalClient,
  getTemporalClient,
  temporalTaskQueue = 'flows-main',
  // Master key for encrypting per-trigger HMAC secrets at rest (AES-256-GCM via encryptSecret).
  // Resolved fail-closed (#636): a real key MUST be supplied via FLOW_TRIGGER_SECRET_KEY in
  // production; absent it, this is null and trigger-secret operations are refused (never a
  // hardcoded default). A non-production profile falls back to the dev key for local/test runs.
  secretMasterKey = resolveTriggerSecretKey(),
  // Kafka consumer factory: () => consumer with subscribe/run/stop. Injected so the registry can be
  // exercised without a live broker (tests) and so production threads the real KafkaJS consumer.
  kafkaConsumerFactory,
  // Starts a flow execution for a matched platform event. Supplied by flow-executor so all
  // StartWorkflowExecution calls (and triggerType stamping) stay in one place.
  startTriggeredExecution,
  logger = console,
} = {}) {
  const schedules = createScheduleGateway({ temporalClient, getTemporalClient, logger });
  let consumer = null;
  let consumerSubscriptions = new Set();

  // -- Cron -----------------------------------------------------------------------------------

  async function registerCronTrigger({ identity, flowId, version, trigger }) {
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    const opts = trigger.options ?? {};
    return schedules.upsertSchedule({
      scheduleId,
      cronExpression: trigger.schedule,
      // Map the DSL overlap option (lowercase friendly name) to the SDK's UPPERCASE enum.
      overlap: mapOverlapPolicy(opts.overlap ?? DEFAULT_OVERLAP),
      catchupWindow: opts.catchupWindow ?? DEFAULT_CATCHUP_WINDOW,
      taskQueue: temporalTaskQueue,
      // The cron schedule fires the interpreter with the tenant envelope + triggerType=cron.
      args: [{ tenant: { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, flowVersion: String(version) } }],
      searchAttributes: {
        tenantId: [identity.tenantId],
        workspaceId: [identity.workspaceId],
        flowId: [flowId],
        flowVersion: [String(version)],
        triggerType: [TRIGGER_TYPES.CRON],
      },
    });
  }

  // -- Webhook --------------------------------------------------------------------------------

  async function registerWebhookTrigger({ identity, flowId, trigger }) {
    // Fail closed (#636): never encrypt a trigger secret with a hardcoded/absent key. In production
    // without FLOW_TRIGGER_SECRET_KEY, refuse the operation rather than persist a secret encrypted
    // with a publicly-known constant.
    if (!secretMasterKey) {
      throw Object.assign(new Error('FLOW_TRIGGER_SECRET_KEY is not configured; webhook trigger registration is refused'),
        { statusCode: 503, code: 'TRIGGER_SECRET_KEY_UNCONFIGURED' });
    }
    const triggerId = triggerIdFor(flowId, trigger);
    const secret = generateSigningSecret();
    const { cipher, iv } = encryptSecret(secret, secretMasterKey);
    await store.upsertSecret({
      tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, triggerId, cipher, iv,
    });
    // The plaintext secret is returned ONCE at publish — never persisted in plaintext, never
    // re-derivable from storage.
    return { triggerId, secret };
  }

  // Load + verify an inbound webhook signature for a trigger. Returns true ONLY when an active
  // secret exists for (triggerId, tenantId, workspaceId) AND the signature matches. A missing
  // secret, a foreign tenant, or a bad signature all return false (fail-closed, no run started).
  async function verifyWebhook({ identity, triggerId, rawBody, signatureHeader }) {
    if (!signatureHeader) return false;
    // Fail closed (#636): with no configured master key there is nothing to decrypt the stored
    // secret against, so no signature can be trusted — refuse (no run started).
    if (!secretMasterKey) return false;
    const row = await store.getSecret({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, triggerId });
    if (!row) return false;
    let secret;
    try {
      secret = decryptSecret(row.cipher, row.iv, secretMasterKey);
    } catch {
      return false;
    }
    return verifyIncomingWebhook(rawBody, signatureHeader, secret);
  }

  // -- Platform event -------------------------------------------------------------------------

  async function registerEventTrigger({ identity, flowId, version, trigger }) {
    const triggerId = triggerIdFor(flowId, trigger);
    const topicRef = physicalTopicForTrigger(identity.tenantId, identity.workspaceId, trigger);
    await store.upsertRegistration({
      tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, version, triggerId,
      triggerType: TRIGGER_TYPES.PLATFORM_EVENT, triggerDef: trigger, topicRef,
    });
    await refreshConsumerSubscriptions();
    return { triggerId, topicRef };
  }

  // (Re)subscribe the consumer to the current union of registered platform-event topics. Called on
  // every register/deregister so newly added topics are picked up (design.md risk: subscription
  // drift). A no-op when no consumer factory is wired (no-broker test/dev mode).
  async function refreshConsumerSubscriptions() {
    if (!kafkaConsumerFactory) return;
    const topics = await store.listEventTopics();
    const wanted = new Set(topics);
    // Subscription set unchanged -> nothing to do.
    if (wanted.size === consumerSubscriptions.size && [...wanted].every((t) => consumerSubscriptions.has(t))) {
      return;
    }
    if (wanted.size === 0) {
      consumerSubscriptions = wanted;
      return;
    }
    // KafkaJS requires subscribe() BEFORE run() and FORBIDS subscribe() while the consumer is
    // running ("Cannot subscribe to topic while consumer is running"). On the FIRST registration we
    // subscribe to the full wanted set then start the run loop. To add/remove a topic on an
    // ALREADY-RUNNING consumer we must stop the run loop, re-subscribe to the full wanted set, then
    // restart it — otherwise a publish after boot-time wiring (bootFlowTriggers already started the
    // consumer) 502s with TRIGGER_REGISTRATION_FAILED. (live campaign 2026-06-18, #564.)
    if (!consumer) {
      consumer = await kafkaConsumerFactory();
      await consumer.subscribe({ topics: [...wanted] });
      await consumer.run({ eachMessage: onConsumerMessage });
    } else {
      if (typeof consumer.stop === 'function') await consumer.stop();
      await consumer.subscribe({ topics: [...wanted] });
      await consumer.run({ eachMessage: onConsumerMessage });
    }
    consumerSubscriptions = wanted;
  }

  // Each consumed Kafka message: look up the registered platform-event trigger(s) for the message's
  // physical topic and start the bound flow. The topic ALREADY embeds tenantId/workspaceId so the
  // lookup can never cross tenants (structural isolation). Dedup key from topic+partition+offset so
  // a redelivered offset starts at most one execution (Temporal workflow-id uniqueness).
  async function onConsumerMessage({ topic, partition, message }) {
    try {
      const matches = await store.findRegistrationsByTopic({ topicRef: topic });
      for (const reg of matches) {
        const dedupKey = `pe:${reg.trigger_id}:${topic}:${partition}:${message.offset}`;
        let payload;
        try {
          payload = message.value ? JSON.parse(message.value.toString()) : {};
        } catch {
          payload = { raw: message.value ? message.value.toString() : null };
        }
        await startTriggeredExecution?.({
          identity: { tenantId: reg.tenant_id, workspaceId: reg.workspace_id },
          flowId: reg.flow_id,
          version: reg.version,
          input: payload,
          triggerType: TRIGGER_TYPES.PLATFORM_EVENT,
          workflowIdOverride: dedupKey,
        });
      }
    } catch (err) {
      logger?.error?.('[flow-trigger-registry] consumer message failed:', err?.message ?? err);
    }
  }

  // -- Public lifecycle -----------------------------------------------------------------------

  // Register all triggers declared in a freshly published version. Cron -> Temporal Schedule;
  // webhook -> secret (returned once); platform-event -> registration row + consumer refresh.
  async function registerTriggers(flowId, version, triggerDefs, identity) {
    const result = { cron: [], webhooks: [], events: [] };
    for (const trigger of triggerDefs ?? []) {
      const kind = trigger?.kind;
      if (kind === 'cron') {
        await registerCronTrigger({ identity, flowId, version, trigger });
        result.cron.push(scheduleIdFor(identity.tenantId, identity.workspaceId, flowId));
      } else if (kind === 'webhook') {
        result.webhooks.push(await registerWebhookTrigger({ identity, flowId, trigger }));
      } else if (kind === 'platform-event') {
        result.events.push(await registerEventTrigger({ identity, flowId, version, trigger }));
      }
    }
    return result;
  }

  // Remove ALL trigger artifacts for a flow: delete the Temporal Schedule, revoke webhook secrets,
  // delete registration rows, refresh the consumer. Used on unpublish + delete (no orphans).
  async function deregisterTriggers(flowId, identity) {
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    let scheduleResult = { deleted: false };
    try {
      scheduleResult = await schedules.deleteSchedule({ scheduleId });
    } catch (err) {
      logger?.error?.('[flow-trigger-registry] deregister schedule failed:', err?.message ?? err);
    }
    const revoked = await store.revokeSecretsForFlow({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId });
    const removed = await store.deleteRegistrationsForFlow({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId });
    await refreshConsumerSubscriptions();
    return { scheduleId, scheduleDeleted: scheduleResult.deleted, secretsRevoked: revoked.revoked, registrationsRemoved: removed.removed };
  }

  // Atomically replace version N's trigger registrations with version N+1's. The Temporal Schedule
  // is UPDATED in place (not delete+create) so there is no firing gap; registration rows are
  // upserted to the new version; webhook secrets are rotated. In-flight version-N executions are
  // NOT cancelled — they hold their own pinned version (add-flows-dsl-interpreter-worker pinning).
  async function swapTriggers(flowId, prevVersion, nextVersion, triggerDefs, identity) {
    // registerTriggers' upserts ARE the atomic swap: schedule upsert preserves the schedule and
    // changes the action target to nextVersion; registration upsert flips the version column;
    // webhook secret upsert rotates the secret. No deregister-then-register window.
    return registerTriggers(flowId, nextVersion, triggerDefs, identity);
  }

  // Teardown seam consumed by services/provisioning-orchestrator workflows-applier: remove every
  // trigger artifact for a tenant (schedules are removed per-flow elsewhere; here we purge the
  // tenant's secret + registration rows). Returns { removed } for the applier's resource result.
  async function removeTriggerArtifacts(tenantId) {
    return store.deleteAllForTenant({ tenantId });
  }

  async function close() {
    try { await consumer?.stop?.(); } catch { /* best-effort */ }
    try { await consumer?.disconnect?.(); } catch { /* best-effort */ }
    consumer = null;
    consumerSubscriptions = new Set();
  }

  return {
    registerTriggers,
    deregisterTriggers,
    swapTriggers,
    verifyWebhook,
    removeTriggerArtifacts,
    // Exposed for the consumer-refresh-on-boot path and tests.
    refreshConsumerSubscriptions,
    store,
    close,
  };
}

// ---------------------------------------------------------------------------------------------
// Boot wiring (change: add-event-trigger-integration / #564).
//
// The SINGLE place a process boots the platform-event trigger plane. It (1) constructs the
// registry sharing the executor's Temporal client + Kafka consumer factory, (2) attaches it to the
// flow executor (so a publish registers triggers and a delete deregisters them), and CRUCIALLY
// (3) STARTS the Kafka consumer for ALREADY-REGISTERED platform-event triggers on boot.
//
// Why (3) matters: registerEventTrigger only refreshes the consumer when a NEW trigger is published
// IN THIS PROCESS. A flow published in a PRIOR process (the live scenario: publish flow, restart /
// roll the pod, then publish an event) leaves a flow_trigger_registrations row but a DORMANT
// consumer — so the matching event is consumed by no one and starts no execution (the live-campaign
// gap, audit/live-campaign/evidence/23-events-functions.md). refreshConsumerSubscriptions() on boot
// re-subscribes to the union of persisted registrations and starts the run loop, closing the gap.
//
// The store query needs its table; the caller is expected to have run ensureSchema() (main.mjs does
// it for the flow executor's metadata pool). The boot refresh is best-effort: a broker outage at
// boot logs and does not crash the process — a later publish re-attempts the subscription.
export async function wireFlowTriggers({
  flowExecutor,
  store = createTriggerStore(),
  temporalClient,
  getTemporalClient,
  temporalTaskQueue = 'flows-main',
  secretMasterKey,
  kafkaConsumerFactory,
  logger = console,
} = {}) {
  const registry = createFlowTriggerRegistry({
    store,
    temporalClient,
    getTemporalClient,
    temporalTaskQueue,
    secretMasterKey,
    kafkaConsumerFactory,
    // The platform-event consumer starts the bound flow through the executor's single start path.
    startTriggeredExecution: (args) => flowExecutor.startTriggeredExecution(args),
    logger,
  });
  flowExecutor.setTriggerRegistry(registry);
  // Start the consumer for registrations that already exist (a process restart / rolled pod). A
  // no-op when no consumer factory is wired (no-broker dev/test) or no registrations exist yet.
  try {
    await registry.refreshConsumerSubscriptions();
  } catch (err) {
    logger?.error?.('[flow-trigger-registry] boot consumer subscription failed (will retry on next publish):', err?.message ?? err);
  }
  return registry;
}

export { WORKFLOW_TYPE };
