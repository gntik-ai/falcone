## 1. Baseline and cross-tenant probe suite (write first — red before implementation)

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh` (455 → 499 with new probes)
- [x] 1.2 Confirm `openspec validate add-flows-tenancy-isolation-limits --strict` passes
- [x] 1.3 Write two-tenant black-box probe fixture: `tests/blackbox/flows-tenancy-isolation.test.mjs` with `TENANT_A` / `TENANT_B` (pattern from `audit-anomaly-alerting.test.mjs`; gateway-injected identities A/B)
- [x] 1.4 Probe: tenant A list-flows → workspace B → scoped to A, zero tenant-B data (bbx-flows-ten-iso-01)
- [x] 1.5 Probe: tenant A get-flow → flow owned by tenant B → 404 (bbx-flows-ten-iso-02)
- [x] 1.6 Probe: tenant A start-execution → flow owned by tenant B → 404/403 (bbx-flows-ten-iso-03)
- [x] 1.7 Probe: tenant A get-execution-detail → workflowId with `tenantB:` prefix → 404 (bbx-flows-ten-iso-04)
- [x] 1.8 Probe: tenant A list-executions with injected `tenantId` filter override → only A's executions (bbx-flows-ten-iso-05)
- [x] 1.9 Probe: tenant A send-signal → `tenantB:` prefix → 404/403 (bbx-flows-ten-iso-06)
- [x] 1.10 Probe: tenant A cancel/retry → `tenantB:` prefix → 404/403 (bbx-flows-ten-iso-07)
- [x] 1.11 Probe: tenant A get-execution-history → `tenantB:` prefix → 404 (bbx-flows-ten-iso-08)
- [x] 1.12 Probe: forged workflow ID (valid UUID, `tenantB:` prefix) → 404 with NO Temporal RPC (rpc spy) (bbx-flows-ten-iso-09)
- [x] 1.13 Confirm probes are red before implementation (the prefix-interception + visibility-injection code below is what turns them green; the pre-existing prefix guard already covered some)

## 2. Workflow ID server-side generation and prefix interception

- [x] 2.1 `buildWorkflowId(tenantId, workspaceId, flowId)` produces `{t}:{w}:{f}:{randomUUID}` — already in `flow-executor.mjs` (#361); covered by bbx-flows-ten-cred-01
- [x] 2.2 Client-supplied `workflowId` is never read at execution start (the executor always generates its own; the start handler never threads a client id) — covered by bbx-flows-ten-cred-01/iso
- [x] 2.3 `assertOwnedWorkflowId` (the spec's `assertWorkflowIdBelongsToTenant`) is called at the start of get/history, cancel, retry, signal; foreign prefix → 404 (read) / 403 (mutating) with no Temporal RPC — bbx-flows-ten-iso-04..09
- [x] 2.4 Unit tests for `buildWorkflowId` / `parseWorkflowId` in `tests/blackbox/flows-execution-credentials.test.mjs` (bbx-flows-ten-cred-01/02)

## 3. Tenancy model enforcement in flow executor

- [x] 3.1 ADR-11 (#356) chose the SHARED-NAMESPACE model (`falcone-flows` + `tenantId` search attribute). The executor's `temporalNamespace='falcone-flows'` default encodes it; no compile-time flag needed (the namespace-per-tenant branch is unused, see Deviation note in change README)
- [x] 3.2 `visibilityQuery({ identity, ..., clientQuery })` injects `tenantId='<id>' AND workspaceId='<id>'` and `sanitizeClientQuery` STRIPS any caller-supplied tenantId/workspaceId clause before AND-joining the residue — bbx-flows-ten-iso-05, bbx-flows-ten-cred-10
- [x] 3.3 `searchAttributesFor` stamps `tenantId` + `workspaceId` at `StartWorkflowOptions.searchAttributes` on every start — already in #361, exercised by the list/detail probes
- [x] 3.4 Namespace-per-tenant path: N/A — ADR-11 selected shared-namespace (recorded in design Q1 + README deviation)
- [x] 3.5 Namespace-per-tenant path: N/A (workflow-ID prefix interception is the per-object gate under the shared model — task 2.3)
- [x] 3.6 Visibility-filter injection resistance proven (bbx-flows-ten-iso-05) and the sanitizer unit-tested (bbx-flows-ten-cred-10)

## 4. Per-execution short-lived credentials

- [x] 4.1 `mintExecutionToken(tenantId, workspaceId, maxRunDurationMs)` (HMAC-SHA256 over canonical JSON, workspace-scoped key, `expiresAt` clamped to the max run duration) in `apps/control-plane/src/runtime/execution-token.mjs`
- [x] 4.2 Token stored in the Temporal workflow memo (`EXECUTION_TOKEN_MEMO_KEY`) at start AND carried in the tenant envelope; memo is not a search attribute (not queryable)
- [x] 4.3 `validateExecutionToken` (control-plane) + `assertExecutionToken` (worker, non-retryable) throw `EXECUTION_TOKEN_EXPIRED` / `EXECUTION_TOKEN_TENANT_MISMATCH` / `EXECUTION_TOKEN_INVALID`
- [x] 4.4 `mintExecutionToken` wired into start + retry; `assertExecutionToken` wired into the catalog `dispatchTask` gate (runs for every REGISTERED first-party activity before it touches a data store)
- [x] 4.5 Black-box tests: expired → `EXECUTION_TOKEN_EXPIRED`; mismatched tenant → `EXECUTION_TOKEN_TENANT_MISMATCH`; valid → proceeds (bbx-flows-ten-cred-05/06/09, bbx-flows-ten-actgate-01/02/03; real-stack round-trip env-flows-ten-cred-01/02/03)

## 5. Quota dimension seed migration

- [x] 5.1 Migration `services/provisioning-orchestrator/src/migrations/121-flow-quota-dimensions.sql` seeds the five dimensions (D6 defaults, `unit='count'`, `ON CONFLICT (dimension_key) DO NOTHING`)
- [x] 5.2 Idempotency verified against live Postgres (double-apply → exactly 5 rows, documented defaults)
- [x] 5.3 `max_concurrent_executions` enforced in the start handler (usage = running executions, tenant+workspace-scoped) → 429 on hard limit (bbx-flows-ten-quota-01)
- [x] 5.4 `flow_starts_per_minute` enforced at the start rate gate → 429 (bbx-flows-ten-quota-05)
- [x] 5.5 `max_flows` enforced in the create handler → 429 (bbx-flows-ten-quota-03)
- [x] 5.6 `max_flow_versions` enforced in the publish handler → 429 (bbx-flows-ten-quota-04)
- [x] 5.7 `flow_signal_rate_per_minute` enforced in the signal handler (gate wired before any Temporal call)
- [x] 5.8 Black-box tests: hard limit → 429 with correct `dimension`; tenant B unaffected when tenant A is at limit (bbx-flows-ten-quota-01/02)

## 6. Audit event emission

- [x] 6.1 `flowLifecycleEvent` contract entry added to `services/audit/src/contract-boundary.mjs` (eventType/tenantId/workspaceId/actorId/flowId/flowVersion/executionId/occurredAt); builder in `flow-lifecycle-events.mjs`
- [x] 6.2 `flow.definition_created` emitted from create (bbx-flows-ten-audit-01)
- [x] 6.3 `flow.definition_updated` emitted from update (bbx-flows-ten-audit-01)
- [x] 6.4 `flow.version_published` emitted from publish (bbx-flows-ten-audit-01/04)
- [x] 6.5 `flow.definition_deleted` emitted from delete (bbx-flows-ten-audit-01)
- [x] 6.6 `flow.execution_started` emitted from start AFTER Temporal ack (bbx-flows-ten-audit-02)
- [x] 6.7 `flow.execution_cancelled` emitted from cancel (bbx-flows-ten-audit-02)
- [x] 6.8 `flow.execution_retry` emitted from retry (bbx-flows-ten-audit-02)
- [x] 6.9 `flow.signal_sent` emitted from signal (bbx-flows-ten-audit-02)
- [x] 6.10 Black-box tests assert each of the eight event types carries tenantId/workspaceId/actorId/occurredAt (bbx-flows-ten-audit-03/06)

## 7. Tenant-deletion cascade

- [x] 7.1 `services/provisioning-orchestrator/src/appliers/workflows-applier.mjs` exports `teardown(tenantId, domainData, { dryRun, credentials, log })` deleting flow_definitions/flow_versions/flow_schedules + terminating Temporal executions (DomainResult shape)
- [x] 7.2 `{ domain: 'workflows', dataKey: 'workflows', teardownKey: 'workflowsTeardown' }` appended to `TEARDOWN_PLAN`
- [x] 7.3 `workflows-applier.mjs::teardown as workflowsTeardown` imported + wired into `resolveDependencies` in `tenant-purge-sweep.mjs`
- [x] 7.4 Black-box test: after purge no flow rows remain (real-stack env-flows-ten-cascade-01); partial failure → `purge.failed` with `failedDomain: "workflows"`, tenant NOT purged (bbx-flows-ten-teardown-04); full success → purged (bbx-flows-ten-teardown-05)
- [x] 7.5 Idempotent: second run removes nothing, no error (bbx-flows-ten-teardown-03; real-stack env-flows-ten-cascade-02); missing table → "already gone" (bbx-flows-ten-teardown-06)

## 8. Verify and validate

- [x] 8.1 `bash tests/blackbox/run.sh` → 499 pass, 0 fail (all probes pass, no regressions)
- [x] 8.2 `openspec validate add-flows-tenancy-isolation-limits --strict` → VALID
- [x] 8.3 Audit event tests pass (bbx-flows-ten-audit-*)
- [x] 8.4 Quota 429 tests pass (bbx-flows-ten-quota-*)
- [x] 8.5 Tenant-deletion tests pass (bbx-flows-ten-teardown-*; real-stack env-flows-ten-cascade-*)
