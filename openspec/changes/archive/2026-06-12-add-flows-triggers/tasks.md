## 1. Baseline and schema

- [x] 1.1 Confirm baseline green: `validate:repo` + `lint` + `test:unit` (corepack unavailable in this env → used `node`/`npm` directly; baseline: unit 630 pass, blackbox 512 pass, contracts 231 pass, validators green)
- [x] 1.2 Author migration `flow_trigger_secrets` (`charts/in-falcone/bootstrap/migrations/20260612-005-flow-trigger-artifacts.sql`): columns `(id, trigger_id, flow_id, tenant_id NOT NULL, workspace_id NOT NULL, cipher TEXT NOT NULL, iv TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`; `idx_fts_tenant_workspace` on `(tenant_id, workspace_id)`; RLS + grants applied by the companion `20260612-006-flow-trigger-rls.sql` (FORCE RLS + falcone_app DML) — mirrors the 003/004 split and `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`
- [x] 1.3 Author migration `flow_trigger_registrations` (same file): columns `(id, flow_id, version INT NOT NULL, trigger_id, trigger_type TEXT NOT NULL, trigger_def JSONB NOT NULL, topic_ref, tenant_id NOT NULL, workspace_id NOT NULL, created_at, updated_at)`; ENABLE/FORCE RLS + falcone_app DML in `20260612-006-flow-trigger-rls.sql`

## 2. Trigger registry module

- [x] 2.1 Created `apps/control-plane/src/runtime/flow-trigger-registry.mjs` exporting `createFlowTriggerRegistry(options)` returning `{ registerTriggers, deregisterTriggers, swapTriggers, verifyWebhook, removeTriggerArtifacts, refreshConsumerSubscriptions, store, close }`
- [x] 2.2 Implemented `registerTriggers(flowId, version, triggerDefs, identity)`: cron → Temporal Schedule `{tenantId}:{workspaceId}:{flowId}` (overlap mapped to the SDK enum + catch-up window from DSL options, fires `DslInterpreterWorkflow`); webhook → `generateSigningSecret` + `encryptSecret` → `flow_trigger_secrets` (secret returned once); platform-event → `flow_trigger_registrations` row + consumer refresh
- [x] 2.3 Implemented `deregisterTriggers(flowId, identity)`: delete the Temporal Schedule by ID, set `flow_trigger_secrets.status = 'revoked'` for `(flow_id, tenant_id, workspace_id)`, delete `flow_trigger_registrations` rows, refresh the consumer
- [x] 2.4 Implemented `swapTriggers(...)`: atomic in-place upsert — schedule `update` preserves the schedule and swaps the action target to nextVersion; registration `version` upserted; webhook secret rotated; in-flight v(N-1) runs keep their pinned version (never cancelled)
- [x] 2.5 Injected `flowTriggerRegistry` into `flow-executor.mjs` (via `setTriggerRegistry` to break the executor↔registry cycle) and call `registerTriggers`/`swapTriggers` on publish and `deregisterTriggers` on delete; wired in `main.mjs`

## 3. Cron trigger — Temporal Schedules

- [x] 3.1 Wired the Temporal `client.schedule` ScheduleClient in `flow-trigger-registry.mjs`; `main.mjs` lazy-connects over `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE` (consistent with `add-flows-temporal-helm`). DEVIATION: the SDK `ScheduleOverlapPolicy` is an UPPERCASE enum — added `mapOverlapPolicy` (DSL `skip`/`allow` → `SKIP`/`ALLOW_ALL`); the real-stack test caught the `ValueError: Invalid enum value: 'skip'`
- [x] 3.2 Unit test `tests/unit/flow-trigger-registry.test.mjs` asserts cross-tenant schedule IDs are structurally distinct (`ten_A:…` vs `ten_B:…`)
- [x] 3.3 Black-box `bbx-flows-trig-01/03`: publish a `0 * * * *` cron flow → schedule exists; delete → schedule deleted. The cron path never writes `scheduled_jobs` (the registry only ever calls `client.schedule.*`; a code comment in `flow-trigger-registry.mjs` states the disjointness from `services/scheduling-engine`)

## 4. Inbound webhook trigger route

- [x] 4.1 Added `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` in `server.mjs` (`{ webhook:true }` route reads the RAW body + signature/delivery headers); identity resolved from the gateway-injected tenant headers (same trust model as scheduling-management::parseIdentity)
- [x] 4.2 HMAC verification in the registry's `verifyWebhook`: loads the per-trigger secret by `(trigger_id, tenant_id, workspace_id)`, decrypts, calls `verifyIncomingWebhook`; the executor returns 401 `INVALID_SIGNATURE` before any Temporal call
- [x] 4.3 Deduplication: `x-platform-webhook-id` → deterministic workflow id `wh-{triggerId}-{deliveryId}`; `startExecution` catches `WorkflowExecutionAlreadyStartedError` (`isWorkflowAlreadyStarted`) and returns `{ deduplicated:true }` → 202, no second run. ADAPTATION: the `:` in the derived id is replaced with `_` (the workflow-id separator is `:`)
- [x] 4.4 `triggerType: "webhook"` stamped on the webhook-initiated `start` (via `searchAttributesFor`)
- [x] 4.5 Route registered in the authoritative gateway allow-list `services/gateway-config/public-route-catalog.json` as `data_access` (established flows-family convention; the generated internal-contracts catalog is regenerated from OpenAPI by `validate:public-api` and does not carry the flows family — spec delta + this task updated to match reality)
- [x] 4.6 Black-box `bbx-flows-trig-05..09`: (a) valid HMAC → 202 + 1 start; (b) invalid HMAC → 401 + 0 starts; (c) missing signature → 401 + 0 starts; (d) replayed delivery id → 202 + only 1 start (deduplicated)

## 5. Platform-event trigger — Kafka consumer

- [x] 5.1 `flows-trigger-consumer` consumer group in `main.mjs` (KafkaJS, enabled with `KAFKA_BROKERS`); subscribes to the union of registered physical topics. Physical topic names via `physicalTopicForTrigger` (reuses `evt.{workspaceId}.{topic}` and `{tenantId}.{workspaceId}.pg-changes`/`.mongo-changes`). DEVIATION: KafkaJS requires `subscribe()` BEFORE `run()` — the real-stack test caught the wrong order
- [x] 5.2 On each message: `store.findRegistrationsByTopic({ topicRef })` (topic embeds tenant/workspace → structural scope); start with the payload as input + dedup key `pe:{triggerId}:{topic}:{partition}:{offset}`; duplicate id → no-op
- [x] 5.3 `triggerType: "platform_event"` stamped on every consumer-initiated start
- [x] 5.4 Consumer subscription set refreshed on `registerTriggers`/`deregisterTriggers`
- [x] 5.5 Black-box `bbx-flows-trig-10..12`: (a) event on tenant A's topic → flow A starts + triggerType=platform_event; (b) foreign-workspace topic → zero matching registrations (cross-tenant denial); (c) duplicate offset → only one start

## 6. triggerType search attribute

- [x] 6.1 `triggerType` (Keyword) is already registered in the Temporal namespace bootstrap (`charts/in-falcone/values.yaml` `temporal.bootstrap.searchAttributes` + `templates/temporal/bootstrap-job.yaml`) alongside `tenantId`/`workspaceId`/`flowId`/`flowVersion` — verified present, no change needed
- [x] 6.2 All four paths stamp `triggerType`: cron (schedule action search attributes), webhook (`searchAttributesFor` via the webhook start), platform-event (consumer start), and manual API starts default to `manual`
- [x] 6.3 Unit + black-box assert the `triggerType` search attribute per trigger type (`bbx-flows-trig-02/06/10/14`, unit `registerTriggers stamps triggerType=cron`)

## 7. Version swap

- [x] 7.1 Unit test `swapTriggers UPDATES the schedule in place — no delete+create gap`: ops are exactly `['create','update']`, never `delete`
- [x] 7.2 Real-stack `tests/env/flows-triggers/trigger-lifecycle.test.mjs` (`flw-rs-trig-04`): publish v1 cron → schedule exists; re-publish v2 → SAME schedule id survives (updated in place); the action pins v2. `flw-rs-trig-01` proves a live cron schedule fires a real run within the window; `flw-rs-trig-02` a live webhook run; `flw-rs-trig-03` a live Redpanda-event run

## 8. Final validation

- [x] 8.1 `openspec validate add-flows-triggers --strict` → `Change 'add-flows-triggers' is valid`
- [x] 8.2 `npm run validate:repo` (exit 0) + `lint` + `npm run test:unit` (639 pass, 1 skipped) green
- [x] 8.3 Black-box `bash tests/blackbox/run.sh` → 531 pass, 0 fail. Contracts 248 (231 pass, 17 skipped). Real-stack `tests/env/flows-triggers/run.sh` → 4/4 pass against live Temporal + Redpanda; workflow-worker env suite unregressed (5/5)
