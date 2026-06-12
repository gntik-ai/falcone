## Context

The control-plane API and DSL interpreter worker (`add-flows-control-plane-api`, `add-flows-dsl-interpreter-worker`) provide the publish pipeline and runtime engine respectively. The missing piece is the trigger plane: the subsystem that converts a published flow's trigger declarations into active listeners and translates external stimuli into `StartWorkflowExecution` calls with full tenant context.

Three trigger types must be supported with distinct integration surfaces: Temporal Schedules (cron), an HTTP ingestion endpoint (webhooks), and a Kafka consumer group (platform events from the `events` capability and both CDC bridges). All three share one invariant: tenant context is injected by the platform, never accepted from external callers.

The existing `services/scheduling-engine` owns standalone cron jobs (table `scheduled_jobs`, managed via `services/scheduling-engine/src/job-model.mjs`) and is not being changed. Flow cron triggers use a separate Temporal Schedules API path; the two systems never share job records or trigger each other.

## Goals / Non-Goals

**Goals:**
- Register and deregister Temporal Schedules atomically with flow publish/unpublish.
- Expose a single webhook ingestion route with per-trigger HMAC verification reusing `services/webhook-engine/src/webhook-signing.mjs` conventions.
- Subscribe to tenant-scoped Kafka topics (events + CDC) and start executions with idempotent workflow-ID dedup keys.
- Swap trigger registrations atomically on version publish without cancelling in-flight runs.
- Stamp `triggerType` on every triggered execution.

**Non-Goals:**
- Migrating `services/scheduling-engine` standalone jobs onto Temporal.
- Trigger marketplace, SaaS connector integrations, or inbound email triggers.
- Quota enforcement and cascade-on-tenant-deletion (owned by #362).
- The DSL schema for trigger declarations (owned by #357/#358).

## Decisions

**D1 — Trigger registry module boundary.** The trigger-registration logic lives in a new `flow-trigger-registry.mjs` (or equivalent) injected into `flow-executor.mjs`, keeping Temporal client usage in one place. The registry exposes `registerTriggers(flowId, version, triggerDefs, identity)`, `deregisterTriggers(flowId, identity)`, and `swapTriggers(flowId, prevVersion, nextVersion, triggerDefs, identity)`. Alternative: embed trigger registration directly in the publish action handler. Rejected because it would scatter Temporal SDK calls across action files.

**D2 — Temporal Schedule IDs.** Format `{tenantId}:{workspaceId}:{flowId}` provides structural tenant isolation without a runtime lookup table. The tenant and workspace are embedded in the ID, making cross-tenant schedule reference structurally impossible. Alternative: opaque UUIDs looked up from a mapping table. Rejected because it adds a database round-trip on every schedule operation for no isolation benefit.

**D3 — HMAC secret storage.** New table `flow_trigger_secrets` with columns `(id, trigger_id, tenant_id, workspace_id, cipher, iv, status, created_at)` mirrors the schema and isolation pattern of `webhook_signing_secrets` (see `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`). Secrets are encrypted at rest with AES-256-GCM using `encryptSecret` from `services/webhook-engine/src/webhook-signing.mjs`. The `tenant_id` and `workspace_id` columns are NOT NULL and indexed, enabling the data-access predicate that prevents cross-tenant secret reads.

**D4 — Webhook deduplication.** The sender is expected to include an `x-platform-webhook-id` delivery-ID header (same convention as `x-platform-webhook-id` in the outbound delivery worker at `services/webhook-engine/actions/webhook-delivery-worker.mjs` line 124). The workflow ID is derived as `wh:{triggerId}:{deliveryId}`. Temporal rejects a `StartWorkflowExecution` with a duplicate workflow ID if a workflow with that ID exists, providing idempotent delivery without extra storage.

**D5 — Platform-event consumer group.** A single persistent Kafka consumer group (`flows-trigger-consumer`) is created per flow-executor instance, subscribing to the union of physical topics for all registered platform-event triggers across all tenants hosted by that instance. Topic names are already structurally tenant-scoped (`evt.{workspaceId}.*` and `{tenantId}.{workspaceId}.*`), so tenant isolation is structural, not runtime-checked. Workflow-ID dedup key: `pe:{triggerId}:{topic}:{partition}:{offset}`.

**D6 — Version swap atomicity.** On publish of version N+1: (1) create new Temporal Schedule (or update existing) for cron triggers; (2) upsert the `flow_trigger_registrations` row to point to version N+1; (3) acknowledge publish. In-flight version N executions are not cancelled — they hold their own pinned version reference (per the `add-flows-dsl-interpreter-worker` version-pinning requirement).

## Risks / Trade-offs

- **Consumer group topic drift** → if a workspace adds new topics after trigger registration, the consumer does not automatically subscribe. Mitigation: the trigger-registry refreshes the consumer's subscription list on each `registerTriggers` / `deregisterTriggers` call.
- **Schedule creation lag at publish time** → Temporal Schedule API calls add latency to the publish path. Mitigation: publish acknowledgement happens after schedule upsert; the operation is idempotent so retries are safe.
- **HMAC secret rotation** → this change covers only initial secret generation. Secret rotation is a separate feature in scope of #362 or a dedicated follow-up.

## Migration Plan

1. Deploy the new `flow_trigger_secrets` migration before any flow executor instance starts registering webhook triggers.
2. The Kafka consumer group starts with an empty subscription set; subscriptions are populated as flows are published.
3. Temporal Schedules are only created on explicit publish; no backfill is needed for pre-existing flow definitions.
4. Rollback: deregister all Temporal Schedules and delete `flow_trigger_secrets` rows; the consumer group offset can be left in place without harm.

## Open Questions

- Should the `x-platform-webhook-id` header be mandatory (reject 400 if absent) or optional (generate a UUID when missing, sacrificing deduplication)? Proposal: required for replay-safe operation; client MUST supply it.
- Grace-period support for rotating per-trigger HMAC secrets (matching `webhook_signing_secrets.status = 'grace'` pattern in `services/webhook-engine/src/webhook-signing.mjs::verifyAgainstSecretSet`): deferred to secret-rotation follow-up (#362 scope).
