## Why

Published flows have no autonomous start mechanism: the control-plane API and DSL interpreter worker are in place, but there is no wiring that converts a cron expression, an inbound HTTP call, or a platform event into a `StartWorkflowExecution` call. Without trigger registration, every flow must be started manually via the API, making scheduled and event-driven automation impossible.

## What Changes

- New `flow-trigger-registry.mjs` in `apps/control-plane/src/runtime/` (or equivalent module boundary): creates, swaps, and deletes trigger registrations atomically on flow publish/unpublish; injected into `flow-executor.mjs` alongside the Temporal client.
- **Cron triggers** → Temporal Schedules (`schedules.create` / `schedules.update` / `schedules.delete`); schedule IDs namespaced `{tenantId}:{workspaceId}:{flowId}` so they are structurally scoped to the tenant; overlap policy and catch-up window taken from the DSL trigger options. Scheduling-engine standalone jobs are NOT migrated and there is no double-trigger path — the two systems are disjoint.
- **Inbound webhook triggers** → new route `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` in the control-plane router; per-trigger HMAC secrets generated with `generateSigningSecret` + encrypted with `encryptSecret` (reusing `services/webhook-engine/src/webhook-signing.mjs` conventions); signature verified via `verifyIncomingWebhook` before any `StartWorkflowExecution` call; invalid or missing signature → 401, no run started; rate-limit class `event-gateway-publish`; replay deduplication via Temporal workflow-ID idempotency keys derived from the delivery ID header.
- **Platform-event triggers** → a long-running consumer in the flow service subscribing to per-workspace Kafka topics (`evt.{workspaceId}.*` physical prefix per `apps/control-plane/src/runtime/events-executor.mjs::physicalTopic`) and CDC topics (`{tenantId}.{workspaceId}.pg-changes` / `{tenantId}.{workspaceId}.mongo-changes` per `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` and `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic`); matching subscriptions are looked up from the published flow trigger table; the event payload is forwarded as workflow input; cross-tenant events are structurally impossible because topic names embed `tenantId` and `workspaceId`; at-least-once delivery with idempotent start (workflow-ID dedup key from the Kafka message offset).
- **Version swap on publish**: when a new version v2 of a flow is published, the trigger registry atomically replaces v1 trigger registrations with v2 equivalents; in-flight v1 runs continue on v1 semantics until completion.
- **`triggerType` search attribute**: every `StartWorkflowExecution` call stamps a `triggerType` search attribute (`cron` | `webhook` | `platform_event` | `manual`) for use by the monitoring sibling (#366).
- New entries in `services/internal-contracts/src/public-route-catalog.json` for the new webhook trigger ingestion route.

## Capabilities

### New Capabilities

*(none — this change extends the existing `workflows` capability introduced by siblings in the same epic)*

### Modified Capabilities

- `workflows`: extends the `workflows` capability (first introduced by `add-flows-dsl-interpreter-worker`) with trigger-registration and trigger-invocation requirements — cron-schedule lifecycle, inbound webhook ingestion, platform-event subscription, version swap, and `triggerType` search attribute stamping.

## Impact

- **Code**: `apps/control-plane/src/runtime/` (new trigger-registry module, modified `flow-executor.mjs`, `server.mjs`, `main.mjs`); new migration for `flow_trigger_secrets` table (per-trigger HMAC secrets with `tenant_id` + `workspace_id` columns consistent with `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`).
- **Contracts**: `services/internal-contracts/src/public-route-catalog.json` gains one new route entry for `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}`.
- **Dependencies**: Temporal Schedules API (already in the Temporal client package provisioned by #356); KafkaJS consumer (already a runtime dep via `apps/control-plane/src/runtime/events-executor.mjs`); `webhook-signing.mjs` reused as-is.
- **Sibling boundaries**: trigger marketplace, external SaaS connectors, inbound email triggers, and migrating `services/scheduling-engine` onto Temporal are out of scope. Quota enforcement and cascade-on-tenant-deletion are owned by #362.
