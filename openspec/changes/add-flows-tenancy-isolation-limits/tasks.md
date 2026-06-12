## 1. Baseline and cross-tenant probe suite (write first — red before implementation)

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-flows-tenancy-isolation-limits --strict` passes
- [ ] 1.3 Write two-tenant black-box probe fixture: `tests/blackbox/flows-cross-tenant-isolation.test.mjs` with `TENANT_A` / `TENANT_B` constants following the pattern in `tests/blackbox/audit-anomaly-alerting.test.mjs`
- [ ] 1.4 Probe: tenant A list-flows → workspace B → 403/404, zero tenant-B data in body
- [ ] 1.5 Probe: tenant A get-flow → flow owned by tenant B → 404
- [ ] 1.6 Probe: tenant A start-execution → flow owned by tenant B → 403/404
- [ ] 1.7 Probe: tenant A get-execution-detail → workflowId with `tenantB:` prefix → 404
- [ ] 1.8 Probe: tenant A list-executions with injected `tenantId` filter override → returns only tenant A executions, empty when tenant A has none
- [ ] 1.9 Probe: tenant A send-signal → workflowId with `tenantB:` prefix → 404
- [ ] 1.10 Probe: tenant A cancel/retry → workflowId with `tenantB:` prefix → 404
- [ ] 1.11 Probe: tenant A get-execution-history → workflowId with `tenantB:` prefix → 404
- [ ] 1.12 Probe: forged workflow ID (valid UUID structure, `tenantB:` prefix) returns 404 without any Temporal RPC (verify via mock/spy)
- [ ] 1.13 Confirm all new probe tests fail (red) before any implementation

## 2. Workflow ID server-side generation and prefix interception

- [ ] 2.1 Implement `generateWorkflowId(tenantId, workspaceId, flowId)` in `apps/control-plane/src/runtime/flow-executor.mjs` producing `{tenantId}:{workspaceId}:{flowId}:{randomUUID}` using `crypto.randomUUID()`
- [ ] 2.2 Strip any client-supplied `workflowId` field from execution-start request body before passing to Temporal
- [ ] 2.3 Implement `assertWorkflowIdBelongsToTenant(workflowId, tenantId)` and call it at the start of describe, history, signal, cancel, and retry handlers; return HTTP 404 on mismatch without issuing any Temporal RPC
- [ ] 2.4 Write unit tests for `generateWorkflowId` and `assertWorkflowIdBelongsToTenant` in `tests/blackbox/`

## 3. Tenancy model enforcement in flow executor

- [ ] 3.1 Confirm the ADR-chosen model from issue #356 (shared-namespace or namespace-per-tenant) and set `TENANCY_MODEL` constant in `flow-executor.mjs`
- [ ] 3.2 Shared-namespace path: implement `buildVisibilityQuery(callerIdentity, clientQueryClauses)` that injects `tenantId = '<tenantId>' AND workspaceId = '<workspaceId>'` and strips any caller-supplied `tenantId`/`workspaceId` clauses before AND-joining
- [ ] 3.3 Shared-namespace path: stamp `tenantId` and `workspaceId` at `StartWorkflowOptions.searchAttributes` on every execution start
- [ ] 3.4 Namespace-per-tenant path: derive namespace as `falcone-{tenantId}` from verified identity; add 60s TTL cache for namespace existence checks
- [ ] 3.5 Namespace-per-tenant path: validate incoming workflowId namespace prefix before routing to Temporal
- [ ] 3.6 Write probe tests for both visibility-filter injection resistance (task 1.8) and confirm they pass after 3.2/3.3

## 4. Per-execution short-lived credentials

- [ ] 4.1 Implement `mintExecutionToken(tenantId, workspaceId, maxRunDurationMs)` using HMAC-SHA256 against a workspace-scoped signing key; include `expiresAt` in token payload
- [ ] 4.2 Store token in Temporal workflow memo at execution start (not in search attributes; memo is not queryable)
- [ ] 4.3 Implement `validateExecutionToken(token, expectedTenantId, expectedWorkspaceId)` for use in activities; throw non-retryable `EXECUTION_TOKEN_EXPIRED` or `EXECUTION_TOKEN_TENANT_MISMATCH` on failure
- [ ] 4.4 Wire `mintExecutionToken` into the execution-start flow and `validateExecutionToken` into at least one representative activity
- [ ] 4.5 Write black-box tests: expired token → activity fails `EXECUTION_TOKEN_EXPIRED`; mismatched tenant → `EXECUTION_TOKEN_TENANT_MISMATCH`; valid token → activity proceeds

## 5. Quota dimension seed migration

- [ ] 5.1 Write migration `services/provisioning-orchestrator/src/migrations/NNN-flow-quota-dimensions.sql` inserting five rows into `quota_dimension_catalog` (see design D6); use `ON CONFLICT (dimension_key) DO NOTHING`
- [ ] 5.2 Verify migration is idempotent by running it twice against a test database
- [ ] 5.3 Call `quota-enforce` action with `dimensionKey: 'max_concurrent_executions'` in the execution-start handler; return 429 on `decision: 'hard_limit_exceeded'`
- [ ] 5.4 Call `quota-enforce` with `dimensionKey: 'flow_starts_per_minute'` in the execution-start rate gate
- [ ] 5.5 Call `quota-enforce` with `dimensionKey: 'max_flows'` in the flow-create handler
- [ ] 5.6 Call `quota-enforce` with `dimensionKey: 'max_flow_versions'` in the flow-publish handler
- [ ] 5.7 Call `quota-enforce` with `dimensionKey: 'flow_signal_rate_per_minute'` in the signal handler
- [ ] 5.8 Write black-box tests: `max_concurrent_executions` hard limit → 429 with correct `dimension`; tenant B unaffected when tenant A is at limit (basic noisy-neighbor)

## 6. Audit event emission

- [ ] 6.1 Add `flow_lifecycle_event` contract entry to `services/audit/src/contract-boundary.mjs` with fields `eventType`, `tenantId`, `workspaceId`, `actorId`, `flowId`, `flowVersion`, `occurredAt`
- [ ] 6.2 Emit `flow.definition_created` from the flow-create handler
- [ ] 6.3 Emit `flow.definition_updated` from the flow-update handler
- [ ] 6.4 Emit `flow.version_published` from the flow-publish handler
- [ ] 6.5 Emit `flow.definition_deleted` from the flow-delete handler
- [ ] 6.6 Emit `flow.execution_started` from the execution-start handler (after Temporal ack)
- [ ] 6.7 Emit `flow.execution_cancelled` from the cancel handler
- [ ] 6.8 Emit `flow.execution_retry` from the retry handler
- [ ] 6.9 Emit `flow.signal_sent` from the signal handler
- [ ] 6.10 Write black-box tests asserting each of the eight audit event types carries `tenantId`, `workspaceId`, `actorId`, and `occurredAt`

## 7. Tenant-deletion cascade

- [ ] 7.1 Create `services/provisioning-orchestrator/src/appliers/workflows-applier.mjs` exporting `teardown(tenantId, domainData, { dryRun, credentials, log })` that deletes `flow_definitions`, `flow_versions`, schedules, and Temporal namespace/executions for the given tenant
- [ ] 7.2 Add `{ domain: 'workflows', dataKey: 'workflows', teardownKey: 'workflowsTeardown' }` to `TEARDOWN_PLAN` in `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs`
- [ ] 7.3 Import `workflows-applier.mjs::teardown as workflowsTeardown` in `tenant-purge-sweep.mjs`
- [ ] 7.4 Write black-box test: after tenant purge, no `flow_definitions` or `flow_versions` rows remain for that tenant; teardown partial failure → `purge.failed` emitted, tenant NOT transitioned to `purged`
- [ ] 7.5 Confirm `teardown` is idempotent: running it twice for the same tenant produces the same outcome and does not error on the second run

## 8. Verify and validate

- [ ] 8.1 Run `bash tests/blackbox/run.sh`; all cross-tenant probe tests (task 1) pass, no regressions
- [ ] 8.2 Run `openspec validate add-flows-tenancy-isolation-limits --strict`; output is VALID
- [ ] 8.3 Confirm audit event tests pass (task 6.10)
- [ ] 8.4 Confirm quota 429 tests pass (task 5.8)
- [ ] 8.5 Confirm tenant-deletion tests pass (task 7.4)
