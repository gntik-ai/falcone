// Flow control-plane executor (change: add-flows-control-plane-api / #361).
//
// The SINGLE component in the control-plane process that holds a Temporal client and the
// ONLY place a Temporal workflow is started / described / signalled / cancelled / listed.
// Mirrors how mongo-data-executor.mjs owns the Mongo connection and events-executor.mjs owns
// the Kafka producer: main.mjs constructs it (behind the TEMPORAL_ADDRESS env guard) and
// threads it through createControlPlaneServer -> buildRoutes. When TEMPORAL_ADDRESS is unset
// the executor is `undefined` and no flows routes are registered (the rest of the
// control-plane runs unchanged).
//
// Tenant isolation is structural: every Temporal workflow ID is generated server-side (clients
// NEVER supply it) and leads with `{tenantId}:{workspaceId}:`. There are two shapes:
//   - manual / trigger-override runs: `{tenantId}:{workspaceId}:{flowId}:{runUuid}` (buildWorkflowId)
//   - schedule-fired (cron) runs:     `{tenantId}:{workspaceId}:{flowId}-workflow-{ISO8601}`
//     (Temporal auto-names a scheduled run `{scheduleId}-workflow-{ISO}`; our scheduleId is
//     `{tenantId}:{workspaceId}:{flowId}` — see flow-trigger-registry). parseWorkflowId handles
//     BOTH (the ISO timestamp's colons require marker-based, not split-based, parsing — #681).
// Before any Temporal command targeting an existing run, the executor verifies the workflow-ID
// prefix matches the caller's `{identity.tenantId}:` — a foreign prefix is treated as not-found
// (404) or forbidden (403) without touching Temporal. The visibility list query always injects
// `tenantId='<identity.tenantId>'` as a non-overridable filter.
//
// Definitions/versions live in Postgres (createFlowStore with a pool) with RLS, or in an
// in-memory Map fallback (no pool) for the no-database black-box mode — the same backend
// split api-keys.mjs / embedding-executor.mjs use.

import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import {
  validateFlowDefinition,
  FLOW_VALIDATION_ERROR_CODES,
} from '../../../../services/internal-contracts/src/flow-definition-validator.mjs';
import {
  validateFlowDefinitionSchema,
} from '../../../../services/internal-contracts/src/flow-definition-schema-validator.mjs';
import { clientError } from './errors.mjs';
// Shared write-capable admin role set + deny predicate (#760). Single source of truth shared with
// server.mjs's API-key management gate (KEY_MGMT_ADMIN_ROLES) so the two role checks cannot drift.
// auth-roles.mjs imports nothing from the runtime → no import cycle.
import { hasWriteCapableRole } from './auth-roles.mjs';
import {
  mintExecutionToken,
  DEFAULT_MAX_RUN_DURATION_MS,
} from './execution-token.mjs';
import {
  buildFlowAuditEvent,
  FLOW_AUDIT_EVENT_TYPES,
} from '../../../../services/audit/src/flow-lifecycle-events.mjs';
import { buildTaskTypeCatalog } from './flow-task-types.mjs';
// scheduleIdFor is a pure id builder (no Temporal dependency) — the registry exports it as the
// single source of the `{tenantId}:{workspaceId}:{flowId}` schedule-id convention. The registry
// does NOT statically import this executor (its consumer callback is injected at runtime), so this
// import introduces no cycle.
import { scheduleIdFor } from './flow-trigger-registry.mjs';

// Temporal workflow type + signal name registered by the interpreter worker
// (services/workflow-worker). The worker's approval signal is `flowApproval` (one channel; the
// payload carries the approving actor + an optional target node id). The public DSL exposes
// "human-approval" as the conventional signal-name path segment for approval nodes; it maps to
// the single `flowApproval` Temporal signal.
const WORKFLOW_TYPE = 'DslInterpreterWorkflow';
const APPROVAL_SIGNAL = 'flowApproval';
const HUMAN_APPROVAL_ALIAS = 'human-approval';

// The flow-DEFINITION write operations — these MUTATE the stored definition/version registry and
// map to the gateway's `structural_admin` privilege domain (#760). They are role-gated (a
// write-capable tenant/workspace role is required) before any store side effect. NOT included:
// the EXECUTION-lifecycle ops (start/cancel/retry/signal a run) and all reads, which are
// `data_access` and out of #760's scope. `validate` is a read-only check (no store mutation) and
// is likewise not a write here. Keep this in sync with the operation names dispatched below and
// the POST/PATCH/DELETE flow-definition routes in server.mjs::buildRoutes.
const DEFINITION_WRITE_OPERATIONS = new Set([
  'create_definition',
  'update_definition',
  'delete_definition',
  'publish_version',
]);

const WORKFLOW_ID_SEPARATOR = ':';

// Recognise Temporal's "a workflow with this id is already running/closed" rejection across SDK
// shapes (WorkflowExecutionAlreadyStartedError / gRPC ALREADY_EXISTS / a fake's marker) so a
// replayed webhook delivery or redelivered Kafka offset is an idempotent no-op (spec: no second
// execution started).
function isWorkflowAlreadyStarted(err) {
  if (!err) return false;
  const name = err.name ?? err.constructor?.name ?? '';
  const code = err.code;
  return (
    name === 'WorkflowExecutionAlreadyStartedError' ||
    err.workflowExecutionAlreadyStarted === true ||
    code === 'WORKFLOW_EXECUTION_ALREADY_STARTED' ||
    code === 6 || // gRPC ALREADY_EXISTS
    /already.*(started|exists|running)/i.test(String(err.message ?? ''))
  );
}

// ---------------------------------------------------------------------------------------------
// Workflow-ID helpers (design.md D2). The separator is `:`, which UUIDs never contain.
// ---------------------------------------------------------------------------------------------

export function buildWorkflowId(tenantId, workspaceId, flowId, runUuid = randomUUID()) {
  return [tenantId, workspaceId, flowId, runUuid].join(WORKFLOW_ID_SEPARATOR);
}

// Literal marker Temporal appends to a SCHEDULE-fired workflow id. A schedule's auto-named run is
// `{scheduleId}-workflow-{ISO8601}` and our scheduleId is `{tenantId}:{workspaceId}:{flowId}`
// (flow-trigger-registry::scheduleIdFor; upsertSchedule sets no explicit workflowId). UUIDs can
// never contain the substring "workflow", so this marker unambiguously identifies a cron-fired id.
const SCHEDULE_WORKFLOW_MARKER = '-workflow-';

// Parse a Temporal workflow id back into { tenantId, workspaceId, flowId, runUuid }. Returns null
// when the shape is wrong (defensive: never throw on a malformed external id).
//
// TWO id shapes must both parse, because the colon separator collides with the colons inside an
// ISO8601 timestamp:
//   1. MANUAL / trigger-override runs (buildWorkflowId): `{tenantId}:{workspaceId}:{flowId}:{runUuid}`
//      — tenantId, workspaceId and runUuid are UUIDs (no colons), so a plain colon split works.
//   2. SCHEDULE-FIRED (cron) runs: Temporal auto-names them `{scheduleId}-workflow-{ISO8601}` where
//      scheduleId = `{tenantId}:{workspaceId}:{flowId}`, e.g.
//      `T:W:F-workflow-2026-06-21T11:06:00Z`. The ISO timestamp's `:`s mean a naive split would
//      mangle the flowId into `F-workflow-2026-06-21T11` and break the OWNER's ownership check
//      (assertOwnedWorkflowId) — surfacing as 404 on get and 403 on cancel/retry of one's OWN run
//      (#681). We therefore take tenantId/workspaceId as the first two colon segments and parse the
//      remainder by the unambiguous `-workflow-` marker rather than by colons.
//
// The return field names are a stable contract: listExecutions / hasActiveExecutions /
// flow-monitoring-executor read `.tenantId`/`.workspaceId`; assertOwnedWorkflowId additionally
// reads `.flowId`. Existing fields are never removed or renamed.
export function parseWorkflowId(workflowId) {
  if (typeof workflowId !== 'string') return null;
  const parts = workflowId.split(WORKFLOW_ID_SEPARATOR);
  // Need at least tenantId + workspaceId + a non-empty remainder (flowId[:runUuid] or
  // flowId-workflow-<ISO8601>). The remainder may itself contain colons (the ISO timestamp).
  if (parts.length < 3) return null;
  const tenantId = parts[0];
  const workspaceId = parts[1];
  const remainder = parts.slice(2).join(WORKFLOW_ID_SEPARATOR);
  if (!tenantId || !workspaceId || !remainder) return null;

  // Shape 2: schedule-fired. The `-workflow-` marker can never appear inside a UUID flowId, so its
  // presence unambiguously identifies a cron-fired id and its first occurrence cleanly separates
  // the flowId from Temporal's `workflow-{ISO8601}` segment.
  const markerIdx = remainder.indexOf(SCHEDULE_WORKFLOW_MARKER);
  if (markerIdx !== -1) {
    // A marker at index 0 means an empty flowId — reject rather than fall through to the manual
    // parse (which would otherwise mistake `-workflow-...` for a `{flowId}:{runUuid}` pair).
    if (markerIdx === 0) return null;
    const flowId = remainder.slice(0, markerIdx);
    // runUuid is the `workflow-{ISO8601}` segment (drop only the leading hyphen of the marker).
    const runUuid = remainder.slice(markerIdx + 1);
    if (!flowId || !runUuid) return null;
    return { tenantId, workspaceId, flowId, runUuid };
  }

  // Shape 1: manual / override — `{flowId}:{runUuid}`. flowId is up to the first colon; runUuid is
  // the rest (a UUID, but join defensively in case a future runUuid form carries colons).
  const sepIdx = remainder.indexOf(WORKFLOW_ID_SEPARATOR);
  if (sepIdx <= 0) return null; // no runUuid, or empty flowId
  const flowId = remainder.slice(0, sepIdx);
  const runUuid = remainder.slice(sepIdx + 1);
  if (!flowId || !runUuid) return null;
  return { tenantId, workspaceId, flowId, runUuid };
}

// Strip every `tenantId`/`workspaceId` clause from a client-supplied Temporal visibility query so
// it can never override or broaden the server-injected tenant boundary (spec D2). Matches
// `tenantId = '...'`, `tenantId='...'`, `tenantId IN (...)`, with optional AND/OR connectives, and
// removes them; the remaining (tenant-agnostic) predicates are returned to be AND-joined with the
// authoritative server clause. Returns '' when nothing safe survives. Fail-closed: a query that is
// ENTIRELY tenant-scoping clauses collapses to '' (no broadening possible).
export function sanitizeClientQuery(clientQuery) {
  if (typeof clientQuery !== 'string' || clientQuery.trim() === '') return '';
  // Drop any clause referencing tenantId or workspaceId (the protected attributes), together with
  // a trailing/leading boolean connective so we don't leave dangling AND/OR.
  const TENANT_CLAUSE = /\b(?:tenantId|workspaceId)\b\s*(?:=|!=|IN)\s*(?:\([^)]*\)|'[^']*'|"[^"]*"|[^\s)]+)/gi;
  let residue = clientQuery
    .replace(new RegExp(`(?:\\bAND\\b|\\bOR\\b)?\\s*${TENANT_CLAUSE.source}`, 'gi'), ' ')
    .replace(/\b(AND|OR)\b\s*$/i, ' ')
    .replace(/^\s*\b(AND|OR)\b/i, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // If after stripping there is still a tenantId/workspaceId reference (e.g. nested), discard the
  // whole residue rather than risk a leak.
  if (/\b(tenantId|workspaceId)\b/i.test(residue)) return '';
  return residue;
}

// Normalise a raw Temporal execution status to the title-case visibility form used by
// workflow.list() and the public API. The SDK's handle.describe() returns the protobuf ENUM
// name (e.g. 'COMPLETED', 'RUNNING') while workflow.list() returns the shorter visibility form
// (e.g. 'Completed', 'Running'). We normalise everything to the title-case form so the web
// console's isTerminalExecution() set and the listExecutions status values stay consistent.
const TEMPORAL_STATUS_TITLE_CASE = {
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
  cancelled: 'Cancelled',
  terminated: 'Terminated',
  timedout: 'TimedOut',
  timed_out: 'TimedOut',
  continuedasnew: 'ContinuedAsNew',
  continued_as_new: 'ContinuedAsNew',
  running: 'Running',
};
function normaliseTemporalStatus(rawStatus) {
  if (rawStatus == null) return null;
  const key = String(rawStatus)
    .replace(/^WORKFLOW_EXECUTION_STATUS_/i, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  return TEMPORAL_STATUS_TITLE_CASE[key] ?? rawStatus;
}

// Verify an externally-supplied executionId (== workflowId) belongs to the caller. On any
// mismatch we DO NOT reveal whether the run exists for another tenant. `notFoundCode` controls
// whether a foreign/owned-mismatch surfaces as 404 (read paths: get/detail) or 403 (mutating
// run paths: cancel/retry/signal) per the spec scenarios.
function assertOwnedWorkflowId(workflowId, identity, { workspaceId, flowId, forbid = false } = {}) {
  const parsed = parseWorkflowId(workflowId);
  const owned =
    parsed &&
    parsed.tenantId === identity.tenantId &&
    (workspaceId === undefined || parsed.workspaceId === workspaceId) &&
    (flowId === undefined || parsed.flowId === flowId);
  if (!owned) {
    if (forbid) {
      throw clientError('Forbidden', 403, 'CROSS_TENANT_FORBIDDEN');
    }
    throw clientError('Execution not found', 404, 'EXECUTION_NOT_FOUND');
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// Definition / version store. With a `pool` it is Postgres-backed (RLS-enforced under
// falcone_app); with no pool it is an in-memory Map (single-process / black-box fallback).
// Tenant + workspace are ALWAYS taken from the verified identity, never from a request body.
// ---------------------------------------------------------------------------------------------

export function createFlowStore({ pool } = {}) {
  return pool ? createPostgresFlowStore(pool) : createInMemoryFlowStore();
}

function defRowToResource(row) {
  if (!row) return null;
  return {
    flowId: row.flow_id,
    name: row.name,
    status: row.status,
    dslApiVersion: row.dsl_api_version,
    definitionYaml: row.definition_yaml ?? null,
    definition: row.definition_json ?? {},
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionRowToResource(row, { includeDefinition = false } = {}) {
  if (!row) return null;
  const base = {
    flowId: row.flow_id,
    version: Number(row.version),
    dslApiVersion: row.dsl_api_version,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
  if (includeDefinition) {
    base.definitionYaml = row.definition_yaml ?? null;
    base.definition = row.definition_json ?? {};
  }
  return base;
}

function createInMemoryFlowStore() {
  // key: `${tenantId} ${workspaceId} ${flowId}`
  const defs = new Map();
  const versions = new Map(); // same key -> array of version records (1-based)
  const key = (t, w, f) => `${t} ${w} ${f}`;

  return {
    async ensureSchema() { /* no-op */ },

    async createDefinition({ tenantId, workspaceId, flowId, name, definitionYaml, definition, dslApiVersion, createdBy }) {
      const k = key(tenantId, workspaceId, flowId);
      if (defs.has(k)) throw clientError('Flow already exists', 409, 'FLOW_EXISTS');
      const now = new Date().toISOString();
      const row = {
        flow_id: flowId, tenant_id: tenantId, workspace_id: workspaceId, name,
        definition_yaml: definitionYaml ?? null, definition_json: definition ?? {},
        dsl_api_version: dslApiVersion ?? 'v1.0', status: 'draft',
        created_by: createdBy ?? null, created_at: now, updated_at: now,
      };
      defs.set(k, row);
      return defRowToResource(row);
    },

    async listDefinitions({ tenantId, workspaceId }) {
      const out = [];
      for (const row of defs.values()) {
        if (row.tenant_id === tenantId && row.workspace_id === workspaceId) out.push(defRowToResource(row));
      }
      return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },

    async getDefinition({ tenantId, workspaceId, flowId }) {
      return defRowToResource(defs.get(key(tenantId, workspaceId, flowId)));
    },

    async updateDefinition({ tenantId, workspaceId, flowId, changes }) {
      const k = key(tenantId, workspaceId, flowId);
      const row = defs.get(k);
      if (!row) return null;
      if (changes.name !== undefined) row.name = changes.name;
      if (changes.definitionYaml !== undefined) row.definition_yaml = changes.definitionYaml;
      if (changes.definition !== undefined) row.definition_json = changes.definition;
      if (changes.dslApiVersion !== undefined) row.dsl_api_version = changes.dslApiVersion;
      row.updated_at = new Date().toISOString();
      return defRowToResource(row);
    },

    async deleteDefinition({ tenantId, workspaceId, flowId }) {
      const k = key(tenantId, workspaceId, flowId);
      const had = defs.delete(k);
      return { removed: had };
    },

    async insertVersion({ tenantId, workspaceId, flowId, definitionYaml, definition, dslApiVersion, createdBy }) {
      const k = key(tenantId, workspaceId, flowId);
      const list = versions.get(k) ?? [];
      const version = list.length + 1;
      const row = {
        flow_id: flowId, tenant_id: tenantId, workspace_id: workspaceId, version,
        definition_yaml: definitionYaml ?? null, definition_json: definition ?? {},
        dsl_api_version: dslApiVersion ?? 'v1.0', created_by: createdBy ?? null,
        created_at: new Date().toISOString(),
      };
      list.push(row);
      versions.set(k, list);
      return versionRowToResource(row);
    },

    async listVersions({ tenantId, workspaceId, flowId }) {
      const list = versions.get(key(tenantId, workspaceId, flowId)) ?? [];
      return list.map((row) => versionRowToResource(row)).sort((a, b) => a.version - b.version);
    },

    async getVersion({ tenantId, workspaceId, flowId, version, includeDefinition }) {
      const list = versions.get(key(tenantId, workspaceId, flowId)) ?? [];
      const row = list.find((r) => Number(r.version) === Number(version));
      return versionRowToResource(row, { includeDefinition });
    },

    async getLatestVersion({ tenantId, workspaceId, flowId, includeDefinition }) {
      const list = versions.get(key(tenantId, workspaceId, flowId)) ?? [];
      const row = list[list.length - 1];
      return versionRowToResource(row, { includeDefinition });
    },
  };
}

function createPostgresFlowStore(pool) {
  return {
    async ensureSchema() {
      // The .sql migrations (charts/in-falcone/bootstrap/migrations/20260612-003,-004) own the
      // authoritative schema + RLS. ensureSchema mirrors api-keys.mjs so a standalone metadata
      // pool boots without the Helm migration job (tables only; RLS is applied by the migration).
      await pool.query(`CREATE TABLE IF NOT EXISTS flow_definitions (
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        flow_id text NOT NULL,
        name text NOT NULL,
        definition_yaml text,
        definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        dsl_api_version text NOT NULL DEFAULT 'v1.0',
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (flow_id),
        UNIQUE (tenant_id, workspace_id, flow_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS flow_versions (
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        flow_id text NOT NULL,
        version integer NOT NULL,
        definition_yaml text,
        definition_json jsonb NOT NULL,
        dsl_api_version text NOT NULL DEFAULT 'v1.0',
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (flow_id, version)
      )`);
    },

    async createDefinition({ tenantId, workspaceId, flowId, name, definitionYaml, definition, dslApiVersion, createdBy }) {
      try {
        const res = await pool.query(
          `INSERT INTO flow_definitions
             (tenant_id, workspace_id, flow_id, name, definition_yaml, definition_json, dsl_api_version, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [tenantId, workspaceId, flowId, name, definitionYaml ?? null, definition ?? {}, dslApiVersion ?? 'v1.0', createdBy ?? null],
        );
        return defRowToResource(res.rows[0]);
      } catch (err) {
        if (err?.code === '23505') throw clientError('Flow already exists', 409, 'FLOW_EXISTS');
        throw err;
      }
    },

    async listDefinitions({ tenantId, workspaceId }) {
      const res = await pool.query(
        `SELECT * FROM flow_definitions WHERE tenant_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
        [tenantId, workspaceId],
      );
      return res.rows.map(defRowToResource);
    },

    async getDefinition({ tenantId, workspaceId, flowId }) {
      const res = await pool.query(
        `SELECT * FROM flow_definitions WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3`,
        [tenantId, workspaceId, flowId],
      );
      return defRowToResource(res.rows[0]);
    },

    async updateDefinition({ tenantId, workspaceId, flowId, changes }) {
      const res = await pool.query(
        `UPDATE flow_definitions SET
            name = COALESCE($4, name),
            definition_yaml = COALESCE($5, definition_yaml),
            definition_json = COALESCE($6, definition_json),
            dsl_api_version = COALESCE($7, dsl_api_version),
            updated_at = now()
          WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3
          RETURNING *`,
        [tenantId, workspaceId, flowId,
         changes.name ?? null, changes.definitionYaml ?? null,
         changes.definition ?? null, changes.dslApiVersion ?? null],
      );
      return defRowToResource(res.rows[0]);
    },

    async deleteDefinition({ tenantId, workspaceId, flowId }) {
      const res = await pool.query(
        `DELETE FROM flow_definitions WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 RETURNING flow_id`,
        [tenantId, workspaceId, flowId],
      );
      return { removed: res.rowCount > 0 };
    },

    async insertVersion({ tenantId, workspaceId, flowId, definitionYaml, definition, dslApiVersion, createdBy }) {
      // Monotonic server-assigned version number, scoped to the flow.
      const res = await pool.query(
        `INSERT INTO flow_versions
           (tenant_id, workspace_id, flow_id, version, definition_yaml, definition_json, dsl_api_version, created_by)
         SELECT $1,$2,$3,
                COALESCE((SELECT MAX(version) FROM flow_versions WHERE flow_id = $3), 0) + 1,
                $4,$5,$6,$7
         RETURNING *`,
        [tenantId, workspaceId, flowId, definitionYaml ?? null, definition ?? {}, dslApiVersion ?? 'v1.0', createdBy ?? null],
      );
      return versionRowToResource(res.rows[0]);
    },

    async listVersions({ tenantId, workspaceId, flowId }) {
      const res = await pool.query(
        `SELECT tenant_id, workspace_id, flow_id, version, dsl_api_version, created_by, created_at
           FROM flow_versions WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 ORDER BY version ASC`,
        [tenantId, workspaceId, flowId],
      );
      return res.rows.map((row) => versionRowToResource(row));
    },

    async getVersion({ tenantId, workspaceId, flowId, version, includeDefinition }) {
      const res = await pool.query(
        `SELECT * FROM flow_versions WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 AND version = $4`,
        [tenantId, workspaceId, flowId, version],
      );
      return versionRowToResource(res.rows[0], { includeDefinition });
    },

    async getLatestVersion({ tenantId, workspaceId, flowId, includeDefinition }) {
      const res = await pool.query(
        `SELECT * FROM flow_versions WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 ORDER BY version DESC LIMIT 1`,
        [tenantId, workspaceId, flowId],
      );
      return versionRowToResource(res.rows[0], { includeDefinition });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Definition parsing + validation. The validate/publish endpoints reuse the SHARED DSL
// validator (services/internal-contracts/src/flow-definition-validator.mjs) — never a
// reimplementation — so the FLW-E codes + node-scoped errors are identical everywhere.
// ---------------------------------------------------------------------------------------------

// Resolve the parsed definition object for a stored draft. Prefers the persisted
// definition_json; falls back to parsing definition_yaml when only YAML was supplied.
function resolveParsedDefinition(record) {
  if (record.definition && Object.keys(record.definition).length > 0) return record.definition;
  if (record.definitionYaml) {
    try {
      return parseYaml(record.definitionYaml) ?? {};
    } catch {
      throw clientError('Stored draft YAML is not parseable', 422, 'INVALID_YAML');
    }
  }
  return {};
}

// Run the shared validators in the documented order: JSON Schema (structural) FIRST, then the
// semantic validator (FLW-E001..009). The semantic layer assumes a structurally-valid document and
// explicitly skips structural rules (additionalProperties:false, required fields, enums), so a
// definition that violates the schema — e.g. a task node using `params`/`parameters` instead of
// `input` (#625) — must be caught here, not silently dropped and then failed at runtime.
// `taskTypeCatalog` / `resolveSubFlow` are injectable seams; when a caller supplies neither,
// FLW-E006/E004 are no-ops (the validator's documented contract). Returns
// `{ ok, kind, errors }` where kind is 'schema' (→ 400) or 'semantic' (→ 422) on failure.
function runValidation(definition, options = {}) {
  const schema = validateFlowDefinitionSchema(definition);
  if (!schema.ok) return { ok: false, kind: 'schema', errors: schema.errors };
  const semantic = validateFlowDefinition(definition, options);
  if (!semantic.ok) return { ok: false, kind: 'semantic', errors: semantic.errors };
  return { ok: true, kind: null, errors: [] };
}

// Map a failed runValidation result to the appropriate client error. A structural (JSON Schema)
// violation is a malformed request (400, FLOW_DEFINITION_INVALID); a semantic violation is
// unprocessable (422, FLOW_VALIDATION_FAILED) — preserving the established semantic-error contract.
function validationError({ kind, errors }) {
  const statusCode = kind === 'schema' ? 400 : 422;
  const code = kind === 'schema' ? 'FLOW_DEFINITION_INVALID' : 'FLOW_VALIDATION_FAILED';
  return Object.assign(clientError('Flow definition is invalid', statusCode, code), { errors });
}

// Structural (JSON Schema) check at the WRITE boundary (create / update-of-definition). An empty
// draft (no definition supplied) is allowed and validated later at validate/publish; a SUPPLIED
// definition must satisfy the DSL schema so authors get an actionable 400 before publish rather than
// a misleading activity failure at runtime (#625).
function assertWriteDefinitionSchema(definition) {
  if (!definition || typeof definition !== 'object' || Object.keys(definition).length === 0) return;
  const schema = validateFlowDefinitionSchema(definition);
  if (!schema.ok) throw validationError({ kind: 'schema', errors: schema.errors });
}

// The set of signal names a published version accepts: each approval node id, plus the
// conventional `human-approval` alias. Used to reject unknown signal names with 422 before any
// Temporal call (spec: UNKNOWN_SIGNAL).
function signalAllowlist(definition) {
  const names = new Set([HUMAN_APPROVAL_ALIAS]);
  for (const node of definition?.nodes ?? []) {
    if (node?.type === 'approval' && typeof node.id === 'string') names.add(node.id);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Temporal client wrapper — lazy connect (design.md risk: Temporal unavailability at startup).
// The @temporalio/client import is dynamic so the control-plane process loads without the
// package present; route handlers surface 503 TEMPORAL_UNAVAILABLE while disconnected. A
// `temporalClient` may be injected directly (tests) to bypass the real connection.
// ---------------------------------------------------------------------------------------------

function createTemporalGateway({ temporalAddress, temporalNamespace, temporalTaskQueue, temporalClient, logger }) {
  let connection;
  let client = temporalClient ?? null;
  let connecting = null;

  async function getClient() {
    if (client) return client;
    if (!temporalAddress) {
      throw clientError('Temporal is not configured', 503, 'TEMPORAL_UNAVAILABLE');
    }
    if (!connecting) {
      connecting = (async () => {
        try {
          const { Connection, Client } = await import('@temporalio/client');
          connection = await Connection.connect({ address: temporalAddress });
          client = new Client({ connection, namespace: temporalNamespace });
          return client;
        } catch (err) {
          connecting = null;
          logger?.error?.('[flow-executor] Temporal connect failed:', err);
          throw clientError('Temporal is unavailable', 503, 'TEMPORAL_UNAVAILABLE');
        }
      })();
    }
    return connecting;
  }

  return {
    getClient,
    taskQueue: temporalTaskQueue,
    async close() {
      try { await connection?.close?.(); } catch { /* best-effort */ }
      client = temporalClient ?? null;
      connection = undefined;
      connecting = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The executor: one dispatch entrypoint `executeFlows({ operation, identity, ... })`.
// ---------------------------------------------------------------------------------------------

export function createFlowExecutor({
  store = createFlowStore(),
  temporalAddress,
  temporalNamespace = 'falcone-flows',
  temporalTaskQueue = 'flows-main',
  temporalClient,
  taskTypeCatalog,
  resolveSubFlow,
  // Per-tenant/workspace quota gate (change: add-flows-tenancy-isolation-limits). When absent the
  // flows API is unmetered (no-DB black-box default); production injects a gate backed by the
  // provisioning-orchestrator quota-enforce action. A breach raises 429 QUOTA_EXCEEDED.
  quotaGate,
  // Audit sink: receives a flow_lifecycle_event envelope per lifecycle action. When absent audit
  // emission is a no-op (the executor never fails a request because audit is unavailable, but a
  // production deployment always wires the Kafka producer). Must be best-effort.
  auditSink,
  // Trigger registry (change: add-flows-triggers). When injected (here or via setTriggerRegistry to
  // break the construction cycle), publishing a version registers its cron/webhook/platform-event
  // triggers and unpublish/delete deregisters them. The registry shares this executor's Temporal
  // client (it holds the ScheduleClient) and calls back into startTriggeredExecution for
  // platform-event-initiated starts. Absent -> no trigger plane (the flows API surface is unchanged).
  flowTriggerRegistry: injectedTriggerRegistry,
  // Maximum flow run duration; per-execution tokens expire WITH the run and never outlast it.
  maxRunDurationMs = DEFAULT_MAX_RUN_DURATION_MS,
  logger = console,
} = {}) {
  const temporal = createTemporalGateway({ temporalAddress, temporalNamespace, temporalTaskQueue, temporalClient, logger });
  // Mutable so main.mjs can attach the registry AFTER constructing the executor (the registry's
  // platform-event consumer calls back into this executor's startTriggeredExecution — a cycle).
  let flowTriggerRegistry = injectedTriggerRegistry;

  function requireIdentity(identity) {
    if (!identity?.tenantId || !identity?.workspaceId) {
      throw clientError('Missing tenant identity', 401, 'UNAUTHENTICATED');
    }
  }

  // Authorize a flow-DEFINITION write (create / update / delete / publish-a-version) by the
  // verified caller's ROLE, not tenant/workspace membership alone (#760). The gateway strips
  // x-actor-roles for the flows route and the executor verifies the JWT itself, so the roles here
  // come from the verified token (identity.roles = realm_access.roles); on the kind path a
  // read-only `tenant_viewer` therefore arrives as roles:['tenant_viewer'].
  //
  // DENY unless the identity carries a positive write-capable admin role (#773). Empty/missing role
  // claims and API-key/dbRole identities are not structural admins. Cross-tenant access is already
  // denied upstream (server.mjs dispatch → CROSS_TENANT_VIOLATION) BEFORE executeFlows, so this gate
  // fires only for within-tenant callers and never weakens or reorders the cross-tenant path. Store
  // calls below stay scoped by the verified identity.tenantId / identity.workspaceId.
  function requireDefinitionWriteRole(identity) {
    const apiKeyIdentity = Boolean(identity?.dbRole || String(identity?.actorId ?? '').startsWith('apikey:'));
    if (apiKeyIdentity || !hasWriteCapableRole(identity?.roles)) {
      throw clientError(
        'Flow-definition writes require a write-capable tenant/workspace role',
        403,
        'FORBIDDEN',
      );
    }
  }

  // Enforce a quota dimension; a no-op when no gate is wired. Throws 429 on breach.
  async function enforceQuota(dimensionKey, { identity, currentUsage } = {}) {
    if (!quotaGate) return;
    await quotaGate.enforce(dimensionKey, {
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      currentUsage,
    });
  }

  // Best-effort tenant-scoped audit emission. NEVER throws into the request path: a flow action
  // must not fail because the audit sink is momentarily unavailable (the emission is logged).
  async function emitAudit(eventType, { identity, flowId, flowVersion, executionId, triggerType } = {}) {
    if (!auditSink) return;
    try {
      const event = buildFlowAuditEvent({
        eventType,
        tenantId: identity.tenantId,
        workspaceId: identity.workspaceId,
        actorId: identity.actorId ?? `apikey:${identity.roleName ?? 'service'}`,
        flowId,
        flowVersion,
        executionId,
        triggerType,
      });
      await auditSink(event);
    } catch (err) {
      logger?.error?.('[flow-executor] audit emit failed:', err?.message ?? err);
    }
  }

  // Count this tenant+workspace's running executions (across all flows) for the
  // max_concurrent_executions usage. Tenant-scoped via the verified identity; never trusts a
  // client filter. A disconnected Temporal client reports zero (no-DB black-box default).
  async function countRunningExecutions({ identity }) {
    let client;
    try {
      client = await temporal.getClient();
    } catch (err) {
      if (err?.code === 'TEMPORAL_UNAVAILABLE') return 0;
      throw err;
    }
    const query = `tenantId = '${identity.tenantId}' AND workspaceId = '${identity.workspaceId}' AND ExecutionStatus = 'Running'`;
    let count = 0;
    for await (const exec of client.workflow.list({ query })) {
      const parsed = parseWorkflowId(exec.workflowId);
      if (parsed && parsed.tenantId === identity.tenantId) count += 1;
    }
    return count;
  }

  // Map a stored version row's pinned definition to the Temporal start input (the interpreter's
  // InlineWorkflowInput: parsed definition + tenant-context envelope). The per-execution token is
  // carried IN the tenant envelope (the workflow args) so every activity can validate it against
  // the execution's tenant + workspace before touching tenant data. It is deliberately NOT mirrored
  // into the Temporal memo, which would store it as plaintext in visibility/history (#633).
  function startInputFor({ identity, flowId, version, definition, state, executionToken }) {
    return {
      definition,
      tenant: {
        tenantId: identity.tenantId,
        workspaceId: identity.workspaceId,
        flowId,
        flowVersion: String(version),
        ...(executionToken ? { executionToken } : {}),
      },
      ...(state !== undefined ? { state } : {}),
    };
  }

  // triggerType (cron | webhook | platform_event | manual) is stamped on EVERY trigger-initiated
  // start (spec: triggerType search attribute) for the monitoring sibling (#366). A manual
  // API-driven start defaults to `manual`.
  function searchAttributesFor({ identity, flowId, version, triggerType = 'manual' }) {
    return {
      tenantId: [identity.tenantId],
      workspaceId: [identity.workspaceId],
      flowId: [flowId],
      flowVersion: [String(version)],
      triggerType: [triggerType],
    };
  }

  async function resolvePinnedVersion({ identity, flowId, requestedVersion }) {
    const includeDefinition = true;
    const row = requestedVersion == null
      ? await store.getLatestVersion({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, includeDefinition })
      : await store.getVersion({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, version: requestedVersion, includeDefinition });
    if (!row) {
      throw clientError(
        requestedVersion == null ? 'No published version to execute' : `Version ${requestedVersion} not found`,
        404,
        'VERSION_NOT_FOUND',
      );
    }
    return row;
  }

  // -- Execution operations (Temporal-backed) -------------------------------------------------

  async function startExecution({ identity, flowId, version, input, triggerType = 'manual', workflowIdOverride }) {
    const pinned = await resolvePinnedVersion({ identity, flowId, requestedVersion: version });
    // Quota gates run BEFORE any Temporal call so a breach never starts a workflow (spec). Rate
    // gate first (cheap), then concurrency (counts running executions tenant+workspace-scoped).
    await enforceQuota('flow_starts_per_minute', { identity });
    await enforceQuota('max_concurrent_executions', { identity, currentUsage: await countRunningExecutions({ identity }) });
    const client = await temporal.getClient();
    // Manual starts get a fresh server-generated workflow id; trigger starts (webhook/event) supply
    // a DETERMINISTIC dedup key so a replayed delivery / redelivered offset reuses the same id and
    // Temporal's workflow-id uniqueness makes the second start a no-op (idempotent, spec).
    const workflowId = workflowIdOverride
      ? buildWorkflowId(identity.tenantId, identity.workspaceId, flowId, workflowIdOverride)
      : buildWorkflowId(identity.tenantId, identity.workspaceId, flowId);
    // Mint the short-lived, tenant+workspace-scoped token; expiry never outlasts the run.
    const executionToken = mintExecutionToken(identity.tenantId, identity.workspaceId, maxRunDurationMs);
    let handle;
    try {
      handle = await client.workflow.start(WORKFLOW_TYPE, {
        workflowId,
        taskQueue: temporal.taskQueue,
        args: [startInputFor({ identity, flowId, version: pinned.version, definition: pinned.definition, state: input, executionToken })],
        searchAttributes: searchAttributesFor({ identity, flowId, version: pinned.version, triggerType }),
        // The token is carried in the workflow args (tenant envelope) where the worker reads it; it
        // is NOT mirrored into the Temporal memo. A memo is persisted as json/plain in Temporal
        // visibility/history (no PayloadCodec is configured on the client or worker), so a memo copy
        // would expose the bearer token in plaintext to anyone with Temporal visibility access (#633).
      });
    } catch (err) {
      // Duplicate workflow id (replayed webhook delivery / redelivered Kafka offset) -> the run
      // already exists; treat as an idempotent no-op (spec: no second execution started).
      if (isWorkflowAlreadyStarted(err)) {
        return { executionId: workflowId, workflowId, version: pinned.version, status: 'Running', deduplicated: true };
      }
      throw err;
    }
    // Audit AFTER the Temporal ack (the run exists). Best-effort; never fails the request.
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.EXECUTION_STARTED, { identity, flowId, flowVersion: pinned.version, executionId: workflowId, triggerType });
    return {
      executionId: workflowId,
      workflowId,
      runId: handle.firstExecutionRunId ?? handle.runId ?? null,
      version: pinned.version,
      status: 'Running',
    };
  }

  // Start a flow execution from a trigger (webhook / platform-event). Shares startExecution so the
  // triggerType search attribute + audit + execution-token minting are identical to a manual start;
  // the deterministic workflowIdOverride gives idempotent (replay-safe) delivery. Quota gates still
  // apply (a flood of webhook deliveries is metered exactly like manual starts).
  async function startTriggeredExecution({ identity, flowId, version, input, triggerType, workflowIdOverride }) {
    return startExecution({ identity, flowId, version, input, triggerType, workflowIdOverride });
  }

  // Inbound webhook ingestion (spec: POST .../triggers/webhooks/{triggerId}). Verify the HMAC
  // signature against the per-trigger secret BEFORE any Temporal call; an invalid/missing signature
  // is 401 with NO run started. A valid signature starts the bound flow with triggerType=webhook and
  // a deterministic workflow id derived from the delivery id (replay dedup -> 202, no second run).
  async function handleWebhookTrigger({ identity, triggerId, rawBody, signatureHeader, deliveryId, payload }) {
    if (!flowTriggerRegistry) {
      throw clientError('Flow triggers are not enabled', 501, 'TRIGGERS_DISABLED');
    }
    const ok = await flowTriggerRegistry.verifyWebhook({ identity, triggerId, rawBody, signatureHeader });
    if (!ok) {
      throw clientError('Invalid webhook signature', 401, 'INVALID_SIGNATURE');
    }
    // triggerId is `{flowId}:webhook:{path}`; the flowId is the leading segment.
    const flowId = triggerId.split(':')[0];
    // Replay dedup: a deterministic workflow id from the delivery id. A replayed delivery reuses the
    // same id -> Temporal makes the second start a no-op (startExecution returns { deduplicated }).
    const workflowIdOverride = `wh-${triggerId}-${deliveryId ?? randomUUID()}`.replace(/:/g, '_');
    const result = await startTriggeredExecution({
      identity, flowId, version: null, input: payload, triggerType: 'webhook', workflowIdOverride,
    });
    return { accepted: true, executionId: result.executionId, deduplicated: result.deduplicated ?? false };
  }

  // Build the tenant-scoped visibility query. `tenantId` + `workspaceId` are ALWAYS injected from
  // the verified identity and are NOT overridable; flowId narrows further; an optional
  // ExecutionStatus refines. Any client-supplied `clientQuery` is sanitized: every `tenantId`/
  // `workspaceId` clause is STRIPPED before the residue is AND-joined with the server clause, so
  // a crafted filter can never broaden or override the tenant boundary (spec D2 / task 1.8).
  function visibilityQuery({ identity, flowId, status, clientQuery }) {
    const terms = [
      `tenantId = '${identity.tenantId}'`,
      `workspaceId = '${identity.workspaceId}'`,
    ];
    if (flowId) terms.push(`flowId = '${flowId}'`);
    if (status) terms.push(`ExecutionStatus = '${String(status)}'`);
    const residue = sanitizeClientQuery(clientQuery);
    if (residue) terms.push(`(${residue})`);
    return terms.join(' AND ');
  }

  async function listExecutions({ identity, flowId, status, clientQuery }) {
    const client = await temporal.getClient();
    const query = visibilityQuery({ identity, flowId, status, clientQuery });
    const items = [];
    for await (const exec of client.workflow.list({ query })) {
      // Defense in depth: only surface runs whose workflow id is owned by the caller.
      const parsed = parseWorkflowId(exec.workflowId);
      if (!parsed || parsed.tenantId !== identity.tenantId) continue;
      items.push({
        executionId: exec.workflowId,
        workflowId: exec.workflowId,
        runId: exec.runId,
        status: exec.status?.name ?? exec.status ?? null,
        startedAt: exec.startTime ?? null,
        closedAt: exec.closeTime ?? null,
      });
    }
    return { items };
  }

  // Are there active (non-terminal) executions of this flow? Used to gate delete with 409. When
  // no Temporal client is connected the check is a no-op (returns false) so the rest of the
  // control-plane (and the in-memory black-box mode) deletes without infra; a live deployment
  // always has Temporal, so the guard is real where it matters.
  async function hasActiveExecutions({ identity, flowId }) {
    let client;
    try {
      client = await temporal.getClient();
    } catch (err) {
      if (err?.code === 'TEMPORAL_UNAVAILABLE') return false;
      throw err;
    }
    const query = `${visibilityQuery({ identity, flowId })} AND ExecutionStatus = 'Running'`;
    for await (const exec of client.workflow.list({ query })) {
      const parsed = parseWorkflowId(exec.workflowId);
      if (parsed && parsed.tenantId === identity.tenantId) return true;
    }
    return false;
  }

  async function getExecution({ identity, flowId, executionId }) {
    // Prefix check FIRST: never fetch Temporal history for a foreign workflow id (404).
    assertOwnedWorkflowId(executionId, identity, { workspaceId: identity.workspaceId, flowId });
    const client = await temporal.getClient();
    const handle = client.workflow.getHandle(executionId);
    let described;
    try {
      described = await handle.describe();
    } catch (err) {
      throw clientError('Execution not found', 404, 'EXECUTION_NOT_FOUND');
    }
    const events = [];
    try {
      const history = await handle.fetchHistory();
      for (const ev of history?.events ?? []) {
        const activityId = ev?.activityTaskScheduledEventAttributes?.activityId;
        if (activityId) {
          // Map ActivityTaskScheduled.activityId VERBATIM to the DSL node id (drop any
          // `#<loop>` suffix) per the #359 naming convention.
          const hashIdx = activityId.indexOf('#');
          events.push({ nodeId: hashIdx === -1 ? activityId : activityId.slice(0, hashIdx), eventId: String(ev.eventId ?? ''), type: 'ActivityScheduled' });
        }
      }
    } catch (err) {
      logger?.error?.('[flow-executor] fetchHistory failed:', err);
    }
    return {
      executionId,
      workflowId: executionId,
      status: normaliseTemporalStatus(described.status?.name ?? described.status),
      version: described.searchAttributes?.flowVersion?.[0] ?? null,
      startedAt: described.startTime ?? null,
      closedAt: described.closeTime ?? null,
      input: null,
      result: null,
      events,
    };
  }

  // Temporal raises a WorkflowNotFoundError for BOTH a run that never existed AND one that has
  // already closed ("workflow execution already completed"). Detect by error NAME (the @temporalio
  // /client class is loaded dynamically in main.mjs, never statically here — the executor module
  // also boots in the no-Temporal in-memory black-box mode). `code === 5` is the gRPC NOT_FOUND
  // status, kept as a defensive fallback. Without this mapping the raw error has no `.statusCode`
  // and the central catch in server.mjs surfaces it as a 500 CONTROL_PLANE_ERROR (#677).
  function isWorkflowNotFound(err) {
    return err?.name === 'WorkflowNotFoundError' || err?.code === 5;
  }

  async function cancelExecution({ identity, flowId, executionId }) {
    // Mutating run path: a foreign prefix is 403 (spec scenario), not 404.
    assertOwnedWorkflowId(executionId, identity, { workspaceId: identity.workspaceId, flowId, forbid: true });
    const client = await temporal.getClient();
    const handle = client.workflow.getHandle(executionId);
    try {
      await handle.cancel();
    } catch (err) {
      // A missing or already-closed run is a client error (404), not a 500 — mirrors getExecution.
      // Any OTHER error (e.g. TEMPORAL_UNAVAILABLE) is re-thrown unchanged so it still surfaces 500.
      if (isWorkflowNotFound(err)) throw clientError('Execution not found', 404, 'EXECUTION_NOT_FOUND');
      throw err;
    }
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.EXECUTION_CANCELLED, { identity, flowId, executionId });
    return { executionId, workflowId: executionId, status: 'Cancelling' };
  }

  async function retryExecution({ identity, flowId, executionId }) {
    assertOwnedWorkflowId(executionId, identity, { workspaceId: identity.workspaceId, flowId, forbid: true });
    const client = await temporal.getClient();
    // Recover the original pinned version + input from the source run, then start a fresh run
    // with the SAME version + input. The original run is unaffected.
    const source = client.workflow.getHandle(executionId);
    const described = await source.describe();
    const version = described.searchAttributes?.flowVersion?.[0] ?? null;
    const pinned = await resolvePinnedVersion({ identity, flowId, requestedVersion: version });
    const workflowId = buildWorkflowId(identity.tenantId, identity.workspaceId, flowId);
    // A retry is a fresh run → mint a fresh per-execution token scoped to the caller.
    const executionToken = mintExecutionToken(identity.tenantId, identity.workspaceId, maxRunDurationMs);
    const handle = await client.workflow.start(WORKFLOW_TYPE, {
      workflowId,
      taskQueue: temporal.taskQueue,
      args: [startInputFor({ identity, flowId, version: pinned.version, definition: pinned.definition, executionToken })],
      searchAttributes: searchAttributesFor({ identity, flowId, version: pinned.version }),
      // No memo: the token travels in the workflow args (tenant envelope), never in a plaintext
      // Temporal memo/visibility entry (#633).
    });
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.EXECUTION_RETRY, { identity, flowId, flowVersion: pinned.version, executionId: workflowId });
    return {
      executionId: workflowId,
      workflowId,
      runId: handle.firstExecutionRunId ?? handle.runId ?? null,
      version: pinned.version,
      retriedFrom: executionId,
      status: 'Running',
    };
  }

  async function sendSignal({ identity, flowId, executionId, signalName, payload }) {
    assertOwnedWorkflowId(executionId, identity, { workspaceId: identity.workspaceId, flowId, forbid: true });
    // Signal-rate quota gate runs before any Temporal call (spec: per workspace per minute).
    await enforceQuota('flow_signal_rate_per_minute', { identity });
    // Validate the signalName against the pinned published version's allowlist BEFORE any
    // Temporal call. Fetch the run's pinned version from its search attribute.
    const client = await temporal.getClient();
    const source = client.workflow.getHandle(executionId);
    let described;
    try {
      described = await source.describe();
    } catch {
      throw clientError('Execution not found', 404, 'EXECUTION_NOT_FOUND');
    }
    const version = described.searchAttributes?.flowVersion?.[0] ?? null;
    let allow;
    try {
      const pinned = await resolvePinnedVersion({ identity, flowId, requestedVersion: version });
      allow = signalAllowlist(pinned.definition);
    } catch {
      // Risk note: a malformed pinned definition rejects the signal rather than forwarding it.
      throw clientError('Cannot resolve signal allowlist for this execution', 422, 'UNKNOWN_SIGNAL');
    }
    if (!allow.has(signalName)) {
      throw clientError(`Unknown signal "${signalName}"`, 422, 'UNKNOWN_SIGNAL');
    }
    // The DSL approval channel is the single `flowApproval` Temporal signal; the public
    // signalName (an approval node id or the human-approval alias) is carried in the payload's
    // nodeId so the interpreter routes it to the right approval node.
    const nodeId = signalName === HUMAN_APPROVAL_ALIAS ? (payload?.nodeId ?? undefined) : signalName;
    try {
      await source.signal(APPROVAL_SIGNAL, {
        approved: payload?.approved ?? true,
        actor: payload?.actor ?? identity.actorId,
        ...(nodeId ? { nodeId } : {}),
      });
    } catch (err) {
      // describe() above succeeds for a terminal run, but signalling a closed (or vanished) run
      // raises WorkflowNotFoundError → that is a "not running" client error (409), not a 500. Any
      // OTHER error is re-thrown unchanged so genuine infra failures still surface as 500.
      if (isWorkflowNotFound(err)) throw clientError('Execution is not running', 409, 'EXECUTION_NOT_RUNNING');
      throw err;
    }
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.SIGNAL_SENT, { identity, flowId, flowVersion: version, executionId });
    return { executionId, workflowId: executionId, signal: signalName, delivered: true };
  }

  // -- Definition / version operations (Postgres / in-memory store) ---------------------------

  function parseDefinitionInput(body) {
    // Accept either definition_yaml (canonical) or an inline definition object. The parsed JSON
    // is what the validator + runtime consume; the YAML is round-tripped for the editor.
    let definitionYaml = body.definition_yaml ?? body.definitionYaml ?? null;
    let definition = body.definition ?? body.definition_json ?? body.definitionJson ?? undefined;
    if (definition === undefined && definitionYaml) {
      try {
        definition = parseYaml(definitionYaml) ?? {};
      } catch {
        throw clientError('definition_yaml is not valid YAML', 422, 'INVALID_YAML');
      }
    }
    return { definitionYaml, definition: definition ?? {} };
  }

  async function createDefinition({ identity, flowId, body }) {
    const name = body.name;
    if (!name) throw clientError('name is required', 400, 'NAME_REQUIRED');
    // Stored-flow quota gate (per tenant). Usage = current stored definitions for this workspace.
    let currentUsage;
    if (quotaGate) {
      const existing = await store.listDefinitions({ tenantId: identity.tenantId, workspaceId: identity.workspaceId });
      currentUsage = existing.length;
    }
    await enforceQuota('max_flows', { identity, currentUsage });
    const id = flowId ?? body.flow_id ?? body.flowId ?? randomUUID();
    const { definitionYaml, definition } = parseDefinitionInput(body);
    // Reject a structurally-malformed definition at create time (#625) — e.g. a task node carrying
    // `params`/`parameters` instead of `input`, or an unsupported top-level shape — so the author
    // gets a 400 now instead of a misleading activity failure at execution. An empty draft (no
    // definition) is allowed; validate/publish enforce the schema once a definition exists.
    assertWriteDefinitionSchema(definition);
    const created = await store.createDefinition({
      tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: id, name,
      definitionYaml, definition, dslApiVersion: definition.apiVersion ?? body.dsl_api_version ?? 'v1.0',
      createdBy: identity.actorId,
    });
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED, { identity, flowId: created.flowId });
    return created;
  }

  async function getDefinitionOr404({ identity, flowId }) {
    const def = await store.getDefinition({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId });
    if (!def) throw clientError('Flow not found', 404, 'FLOW_NOT_FOUND');
    return def;
  }

  async function validateDraft({ identity, flowId }) {
    const def = await getDefinitionOr404({ identity, flowId });
    const parsed = resolveParsedDefinition(def);
    const result = runValidation(parsed, { taskTypeCatalog, resolveSubFlow });
    if (!result.ok) throw validationError(result);
    return { valid: true };
  }

  async function publishVersion({ identity, flowId }) {
    const def = await getDefinitionOr404({ identity, flowId });
    const parsed = resolveParsedDefinition(def);
    const result = runValidation(parsed, { taskTypeCatalog, resolveSubFlow });
    if (!result.ok) throw validationError(result);
    // Published-version quota gate (per flow). Usage = current published versions of this flow.
    let currentUsage;
    if (quotaGate) {
      const existing = await store.listVersions({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId });
      currentUsage = existing.length;
    }
    await enforceQuota('max_flow_versions', { identity, currentUsage });
    const created = await store.insertVersion({
      tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId,
      definitionYaml: def.definitionYaml, definition: parsed,
      dslApiVersion: parsed.apiVersion ?? def.dslApiVersion ?? 'v1.0', createdBy: identity.actorId,
    });
    await emitAudit(FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED, { identity, flowId, flowVersion: created.version });

    // Trigger plane (change: add-flows-triggers). Register/swap the declared triggers AFTER the
    // version row is durable. Publishing v1 registers; re-publishing (v>1) atomically swaps v(N-1)
    // registrations for vN — the schedule is updated in place, registration rows are upserted to
    // vN, webhook secrets are rotated; in-flight v(N-1) runs keep their pinned version (design D6).
    // The fresh webhook secret(s) are returned ONCE here so the caller can hand them to the tenant.
    let triggers;
    if (flowTriggerRegistry) {
      const triggerDefs = Array.isArray(parsed?.triggers) ? parsed.triggers : [];
      try {
        triggers = created.version === 1
          ? await flowTriggerRegistry.registerTriggers(flowId, created.version, triggerDefs, identity)
          : await flowTriggerRegistry.swapTriggers(flowId, created.version - 1, created.version, triggerDefs, identity);
      } catch (err) {
        // Trigger registration failure must surface (a published version with no live triggers is a
        // silent broken automation) — but the version row already exists, so re-publish is safe
        // (idempotent upserts). Re-raise so the publish response is a clear error.
        logger?.error?.('[flow-executor] trigger registration failed:', err?.message ?? err);
        throw clientError('Trigger registration failed', 502, 'TRIGGER_REGISTRATION_FAILED');
      }
    }
    return { flowId, version: created.version, createdAt: created.createdAt, ...(triggers ? { triggers } : {}) };
  }

  // -- Schedule management (change: add-flow-schedule-management-api / #680) -------------------
  // Tenant/workspace-scoped operate-in-place surface over the per-flow Temporal Schedule created on
  // publish. Structural isolation: every per-flow op derives the schedule id from the VERIFIED
  // identity (tenantId) + the workspace-ownership-validated path (workspaceId) via scheduleIdFor,
  // so a foreign flowId resolves to an id that does not exist -> Temporal NOT_FOUND -> 404 (never
  // 500, never reveals existence). The list op filters by the same `{tenant}:{ws}:` prefix.

  function requireScheduleGateway() {
    const gateway = flowTriggerRegistry?.scheduleGateway;
    if (!gateway) {
      // The trigger plane (and therefore the schedule gateway) is not wired — the schedule
      // surface is unavailable rather than producing an opaque 500.
      throw clientError('Flow scheduling is not enabled', 501, 'FLOW_SCHEDULING_DISABLED');
    }
    return gateway;
  }

  // Parse a `{tenantId}:{workspaceId}:{flowId}` schedule id back into its parts. tenant/workspace
  // ids never contain ':' (slugs); the flowId is the remainder so a ':' in a flow id is preserved.
  function parseScheduleId(scheduleId, { tenantId, workspaceId }) {
    const prefix = `${tenantId}:${workspaceId}:`;
    return { flowId: scheduleId.startsWith(prefix) ? scheduleId.slice(prefix.length) : undefined };
  }

  // The cron expression(s) the user PUBLISHED for a flow, read from the authoritative stored flow
  // definition (the latest published version's `cron` trigger declarations). This is the source of
  // truth for `cron` in the schedule response: the real Temporal SDK COMPILES a cron expression into
  // structured `calendars` and a describe()/list() `ScheduleSpecDescription` OMITS `cronExpressions`
  // (always undefined in production), so reading it back from Temporal would always yield `[]`. We
  // instead round-trip the user's own cron string from the published definition. Returns `[]` on any
  // miss (no published version, no triggers, no cron trigger) — never throws (the caller already
  // resolved the schedule; this is a best-effort enrichment that must not turn a 200 into a 500).
  async function cronExpressionsForFlow({ identity, flowId }) {
    if (!flowId) return [];
    try {
      const row = await store.getLatestVersion({
        tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, includeDefinition: true,
      });
      const triggers = Array.isArray(row?.definition?.triggers) ? row.definition.triggers : [];
      return triggers
        .filter((t) => t?.kind === 'cron' && typeof t?.schedule === 'string' && t.schedule.length > 0)
        .map((t) => t.schedule);
    } catch (err) {
      logger?.error?.('[flow-executor] cron lookup for schedule response failed:', err?.message ?? err);
      return [];
    }
  }

  // Normalise a Temporal ScheduleDescription / ScheduleSummary into a small, STABLE response shape.
  // Never leaks raw Temporal internals (the SDK `raw` field, proto payloads, Date objects). `paused`
  // comes from the describe/summary state; `nextActionTimes` are ISO-8601 strings; `cron` is the
  // AUTHORITATIVE published cron expression(s) when supplied (see cronExpressionsForFlow — Temporal
  // omits them from a describe that only carries structured calendars), falling back to any
  // `cronExpressions` the SDK does surface, else `[]`.
  function normalizeSchedule(schedule, { tenantId, workspaceId, flowId, cron } = {}) {
    const scheduleId = schedule?.scheduleId ?? scheduleIdFor(tenantId, workspaceId, flowId);
    const resolvedFlowId = flowId ?? parseScheduleId(scheduleId, { tenantId, workspaceId }).flowId;
    const toIso = (value) => (value instanceof Date ? value.toISOString() : (typeof value === 'string' ? value : null));
    const nextActionTimes = Array.isArray(schedule?.info?.nextActionTimes)
      ? schedule.info.nextActionTimes.map(toIso).filter((v) => v !== null)
      : [];
    const recentActions = Array.isArray(schedule?.info?.recentActions)
      ? schedule.info.recentActions.slice(-10).map((entry) => ({
          scheduledAt: toIso(entry?.scheduledAt),
          takenAt: toIso(entry?.takenAt),
          workflowId: entry?.action?.workflow?.workflowId ?? null,
        }))
      : [];
    // Prefer the authoritative published cron; fall back to whatever Temporal surfaced (normally none).
    const resolvedCron = Array.isArray(cron) && cron.length > 0
      ? [...cron]
      : (Array.isArray(schedule?.spec?.cronExpressions) ? [...schedule.spec.cronExpressions] : []);
    return {
      scheduleId,
      flowId: resolvedFlowId,
      workspaceId,
      paused: schedule?.state?.paused === true,
      note: schedule?.state?.note ?? null,
      cron: resolvedCron,
      nextActionTimes,
      recentActions,
    };
  }

  async function listSchedules({ identity }) {
    const gateway = requireScheduleGateway();
    // The prefix is the SOLE isolation boundary — only this tenant's + this validated workspace's
    // schedules are returned, even though Temporal's list spans the whole namespace.
    const prefix = `${identity.tenantId}:${identity.workspaceId}:`;
    const summaries = await gateway.listSchedulesByPrefix({ prefix });
    // Enrich each entry with its authoritative published cron (Temporal's list summary omits it).
    // Bounded to this one workspace's schedules; each lookup is the same tenant-scoped store read.
    const items = await Promise.all(summaries.map(async (s) => {
      const flowId = parseScheduleId(s?.scheduleId ?? '', { tenantId: identity.tenantId, workspaceId: identity.workspaceId }).flowId;
      const cron = await cronExpressionsForFlow({ identity, flowId });
      return normalizeSchedule(s, { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, cron });
    }));
    return { items };
  }

  async function getSchedule({ identity, flowId }) {
    const gateway = requireScheduleGateway();
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    const description = await gateway.describeSchedule({ scheduleId });
    if (!description) throw clientError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    const cron = await cronExpressionsForFlow({ identity, flowId });
    return normalizeSchedule(description, { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, cron });
  }

  async function pauseSchedule({ identity, flowId }) {
    const gateway = requireScheduleGateway();
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    const description = await gateway.pauseSchedule({ scheduleId, note: 'Paused via Flows API' });
    if (!description) throw clientError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    const cron = await cronExpressionsForFlow({ identity, flowId });
    return normalizeSchedule(description, { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, cron });
  }

  async function resumeSchedule({ identity, flowId }) {
    const gateway = requireScheduleGateway();
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    const description = await gateway.unpauseSchedule({ scheduleId, note: 'Resumed via Flows API' });
    if (!description) throw clientError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    const cron = await cronExpressionsForFlow({ identity, flowId });
    return normalizeSchedule(description, { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, cron });
  }

  async function triggerSchedule({ identity, flowId }) {
    const gateway = requireScheduleGateway();
    const scheduleId = scheduleIdFor(identity.tenantId, identity.workspaceId, flowId);
    const triggered = await gateway.triggerSchedule({ scheduleId });
    if (!triggered) throw clientError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    return { status: 'triggered', scheduleId };
  }

  // -- Dispatch -------------------------------------------------------------------------------

  async function executeFlows(params = {}) {
    const { operation, identity } = params;
    requireIdentity(identity);
    // Role-gate the DEFINITION-WRITE operations (create / update / delete / publish a version) —
    // the catalog's `structural_admin` privilege domain (#760). Evaluated AFTER requireIdentity and
    // BEFORE any store read/write side effect, so a non-write role performs NOTHING. Execution-
    // lifecycle ops (start/cancel/retry/signal/get/list) and reads are intentionally NOT gated here
    // (they are `data_access`; cancel/retry already enforce cross-tenant run ownership).
    if (DEFINITION_WRITE_OPERATIONS.has(operation)) {
      requireDefinitionWriteRole(identity);
    }
    const flowId = params.flowId;
    switch (operation) {
      case 'create_definition':
        return createDefinition({ identity, flowId, body: params.body ?? {} });
      case 'list_definitions':
        return { items: await store.listDefinitions({ tenantId: identity.tenantId, workspaceId: identity.workspaceId }) };
      case 'list_task_types':
        // Static first-party catalog (FLW-E006 source). Tenant-agnostic data: the descriptors
        // are identical for every workspace, but the route is still identity-gated so only an
        // authenticated console session reaches it. The returned ids are exactly the catalog
        // the validate/publish endpoints enforce against.
        return { items: buildTaskTypeCatalog() };
      case 'get_definition':
        return getDefinitionOr404({ identity, flowId });
      case 'update_definition': {
        await getDefinitionOr404({ identity, flowId });
        const { definitionYaml, definition } = parseDefinitionInput(params.body ?? {});
        // A PATCH that supplies a definition must satisfy the DSL schema too (#625) — otherwise a
        // malformed definition could be smuggled past create-time validation and only fail at
        // runtime. A name-only PATCH (no definition) is unaffected.
        assertWriteDefinitionSchema(definition);
        const changes = {
          ...(params.body?.name !== undefined ? { name: params.body.name } : {}),
          ...(definitionYaml !== null ? { definitionYaml } : {}),
          ...(Object.keys(definition).length > 0 ? { definition, dslApiVersion: definition.apiVersion } : {}),
        };
        const updated = await store.updateDefinition({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId, changes });
        await emitAudit(FLOW_AUDIT_EVENT_TYPES.DEFINITION_UPDATED, { identity, flowId });
        return updated;
      }
      case 'delete_definition': {
        await getDefinitionOr404({ identity, flowId });
        // Reject the delete while any non-terminal execution still references the flow (spec).
        if (await hasActiveExecutions({ identity, flowId })) {
          throw clientError('Flow has active executions and cannot be deleted', 409, 'FLOW_HAS_ACTIVE_EXECUTIONS');
        }
        // Deregister ALL trigger artifacts (schedule + secrets + registrations) BEFORE deleting the
        // definition so no Temporal Schedule or webhook secret outlives the flow (spec: schedule
        // removed before the deletion is acknowledged; no orphaned trigger artifacts).
        if (flowTriggerRegistry) {
          await flowTriggerRegistry.deregisterTriggers(flowId, identity).catch((err) => {
            logger?.error?.('[flow-executor] trigger deregister on delete failed:', err?.message ?? err);
          });
        }
        const removed = await store.deleteDefinition({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId });
        await emitAudit(FLOW_AUDIT_EVENT_TYPES.DEFINITION_DELETED, { identity, flowId });
        return removed;
      }
      case 'validate':
        return validateDraft({ identity, flowId });
      case 'publish_version':
        return publishVersion({ identity, flowId });
      case 'list_versions':
        await getDefinitionOr404({ identity, flowId });
        return { items: await store.listVersions({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId }) };
      case 'get_version': {
        const row = await store.getVersion({
          tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId,
          version: params.version, includeDefinition: true,
        });
        if (!row) throw clientError('Version not found', 404, 'VERSION_NOT_FOUND');
        return row;
      }
      case 'start_execution':
        return startExecution({ identity, flowId, version: params.version, input: params.input });
      case 'webhook_trigger':
        return handleWebhookTrigger({
          identity, triggerId: params.triggerId, rawBody: params.rawBody,
          signatureHeader: params.signatureHeader, deliveryId: params.deliveryId, payload: params.payload,
        });
      case 'list_executions':
        return listExecutions({ identity, flowId, status: params.status, clientQuery: params.query });
      case 'get_execution':
        return getExecution({ identity, flowId, executionId: params.executionId });
      case 'cancel_execution':
        return cancelExecution({ identity, flowId, executionId: params.executionId });
      case 'retry_execution':
        return retryExecution({ identity, flowId, executionId: params.executionId });
      case 'send_signal':
        return sendSignal({ identity, flowId, executionId: params.executionId, signalName: params.signalName, payload: params.payload });
      // Schedule management (#680). list_schedules is workspace-scoped (no flowId); the per-flow ops
      // build the schedule id from the verified identity + validated workspace, so a foreign flow
      // resolves to a non-existent id -> 404 SCHEDULE_NOT_FOUND (cross-tenant access is denied
      // without revealing existence).
      case 'list_schedules':
        return listSchedules({ identity });
      case 'get_schedule':
        return getSchedule({ identity, flowId });
      case 'pause_schedule':
        return pauseSchedule({ identity, flowId });
      case 'resume_schedule':
        return resumeSchedule({ identity, flowId });
      case 'trigger_schedule':
        return triggerSchedule({ identity, flowId });
      default:
        throw clientError(`Unknown flows operation: ${operation}`, 400, 'UNKNOWN_OPERATION');
    }
  }

  async function ensureSchema() {
    await store.ensureSchema?.();
    await flowTriggerRegistry?.store?.ensureSchema?.();
  }

  async function close() {
    await temporal.close();
    await flowTriggerRegistry?.close?.();
  }

  // Attach the trigger registry after construction (breaks the executor<->registry cycle: the
  // registry's consumer needs startTriggeredExecution, which lives on this executor).
  function setTriggerRegistry(registry) {
    flowTriggerRegistry = registry;
  }

  return {
    executeFlows,
    ensureSchema,
    close,
    store,
    setTriggerRegistry,
    // Exposed so an injected registry's platform-event consumer can start executions through the
    // SAME path as a manual start (triggerType stamping + execution-token minting + audit).
    startTriggeredExecution,
    FLOW_VALIDATION_ERROR_CODES,
  };
}

export { WORKFLOW_TYPE, APPROVAL_SIGNAL, HUMAN_APPROVAL_ALIAS };
