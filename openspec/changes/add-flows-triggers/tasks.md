## 1. Baseline and schema

- [ ] 1.1 Confirm baseline green: `corepack pnpm validate:repo && corepack pnpm lint && corepack pnpm test:unit`
- [ ] 1.2 Author migration `flow_trigger_secrets`: columns `(id, trigger_id, tenant_id NOT NULL, workspace_id NOT NULL, cipher TEXT NOT NULL, iv TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`; add `idx_fts_tenant_workspace` on `(tenant_id, workspace_id)`; `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; grant DML to `falcone_app` role — consistent with `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`
- [ ] 1.3 Author migration `flow_trigger_registrations`: columns `(id, flow_id, version INT NOT NULL, trigger_type TEXT NOT NULL, trigger_def JSONB NOT NULL, tenant_id NOT NULL, workspace_id NOT NULL, created_at, updated_at)`; `ENABLE ROW LEVEL SECURITY`; grant DML to `falcone_app`

## 2. Trigger registry module

- [ ] 2.1 Create `apps/control-plane/src/runtime/flow-trigger-registry.mjs` exporting `createFlowTriggerRegistry(options)` returning `{ registerTriggers, deregisterTriggers, swapTriggers, close }`
- [ ] 2.2 Implement `registerTriggers(flowId, version, triggerDefs, identity)`: for each cron trigger create a Temporal Schedule with ID `{tenantId}:{workspaceId}:{flowId}`, overlap policy and catch-up window from DSL options, firing `DslInterpreterWorkflow`; for each webhook trigger generate a secret via `generateSigningSecret`, encrypt via `encryptSecret`, insert into `flow_trigger_secrets`; for each platform-event trigger insert a `flow_trigger_registrations` row and refresh the consumer subscription set
- [ ] 2.3 Implement `deregisterTriggers(flowId, identity)`: delete Temporal Schedules by ID, set `flow_trigger_secrets.status = 'revoked'` for all rows matching `(flow_id, tenant_id, workspace_id)`, delete `flow_trigger_registrations` rows
- [ ] 2.4 Implement `swapTriggers(flowId, prevVersion, nextVersion, triggerDefs, identity)`: atomic update — upsert Temporal Schedule (schedule update preserves spec, changes action target to nextVersion), upsert `flow_trigger_registrations` version, rotate webhook secrets; ensure no in-flight v1 executions are cancelled
- [ ] 2.5 Inject `flowTriggerRegistry` into `flow-executor.mjs` and call `registerTriggers` / `deregisterTriggers` / `swapTriggers` from the publish and unpublish action handlers

## 3. Cron trigger — Temporal Schedules

- [ ] 3.1 Wire Temporal ScheduleClient in `flow-trigger-registry.mjs`; read namespace and address from env vars consistent with `add-flows-temporal-helm` configuration
- [ ] 3.2 Verify schedule ID format `{tenantId}:{workspaceId}:{flowId}` is enforced — add unit test asserting cross-tenant schedule IDs are structurally distinct
- [ ] 3.3 Black-box test: publish flow with `cronExpression: "* * * * *"` → assert Temporal Schedule exists; unpublish → assert schedule deleted; confirm no `scheduled_jobs` row exists in the `services/scheduling-engine` table

## 4. Inbound webhook trigger route

- [ ] 4.1 Add route handler for `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` in `apps/control-plane/src/runtime/` routes; resolve workspace identity from path + trusted gateway headers (same pattern as `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`)
- [ ] 4.2 Implement HMAC verification: load per-trigger secret from `flow_trigger_secrets` via `(trigger_id, tenant_id, workspace_id)` predicate; call `verifyIncomingWebhook(rawBody, signatureHeader, secret)` from `services/webhook-engine/src/webhook-signing.mjs`; return 401 on failure before any Temporal call
- [ ] 4.3 Implement deduplication: extract `x-platform-webhook-id` header; derive workflow ID `wh:{triggerId}:{deliveryId}`; call `StartWorkflowExecution` with that workflow ID; handle `WorkflowExecutionAlreadyStartedError` as 202
- [ ] 4.4 Stamp `triggerType: "webhook"` search attribute on every `StartWorkflowExecution` call from this route
- [ ] 4.5 Add route catalog entry in `services/internal-contracts/src/public-route-catalog.json`: `method: POST`, `path: /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}`, `rateLimitClass: "event-gateway-publish"`, `gatewayRouteClass: "event"`, `authRequired: false` (webhook ingestion is HMAC-authenticated, not OIDC)
- [ ] 4.6 Black-box tests: (a) valid HMAC → 202 + execution started; (b) invalid HMAC → 401 + no execution; (c) missing `x-platform-webhook-signature` → 401; (d) replayed `x-platform-webhook-id` → 202, second execution NOT started

## 5. Platform-event trigger — Kafka consumer

- [ ] 5.1 Implement `flows-trigger-consumer` Kafka consumer group in `flow-trigger-registry.mjs`: subscribes to the union of physical topics for all registered platform-event triggers; uses physical topic names via `physicalTopic(workspaceId, topic)` from `apps/control-plane/src/runtime/events-executor.mjs` and `deriveTopic` from CDC bridge publishers
- [ ] 5.2 On each consumed message: look up matching `flow_trigger_registrations` rows by `(tenant_id, workspace_id, trigger_type='platform_event', topic_ref)`; call `StartWorkflowExecution` with event payload as input; workflow ID dedup key `pe:{triggerId}:{topic}:{partition}:{offset}`; handle `WorkflowExecutionAlreadyStartedError` as no-op
- [ ] 5.3 Stamp `triggerType: "platform_event"` search attribute on every `StartWorkflowExecution` call from the consumer
- [ ] 5.4 Refresh consumer subscription set on `registerTriggers` and `deregisterTriggers` to pick up newly added topics
- [ ] 5.5 Black-box tests: (a) produce event to tenant A's topic → flow A starts; (b) produce event to tenant B's topic → flow A does NOT start (cross-tenant probe); (c) produce duplicate message offset → only one execution started

## 6. triggerType search attribute

- [ ] 6.1 Register `triggerType` as a custom search attribute in Temporal namespace configuration (consistent with `tenantId`, `workspaceId` attributes from `add-flows-control-plane-api`)
- [ ] 6.2 Verify all three trigger code paths (`registerTriggers` cron schedule action, webhook route handler, platform-event consumer) pass `triggerType` as a search attribute to `StartWorkflowExecution`
- [ ] 6.3 Unit tests asserting the search attribute is present in the `StartWorkflowExecution` call options for each trigger type

## 7. Version swap

- [ ] 7.1 Unit test: `swapTriggers` upserts Temporal Schedule (not delete+create) so no gap in schedule firing during swap
- [ ] 7.2 Integration test (real-stack, tests/env): publish v1 with cron trigger → start an execution → publish v2 → assert in-flight v1 execution completes on v1; assert next cron firing uses v2

## 8. Final validation

- [ ] 8.1 `openspec validate add-flows-triggers --strict` passes with zero errors
- [ ] 8.2 `corepack pnpm validate:repo && corepack pnpm lint && corepack pnpm test:unit` passes
- [ ] 8.3 Black-box suite `bash tests/blackbox/run.sh` passes
