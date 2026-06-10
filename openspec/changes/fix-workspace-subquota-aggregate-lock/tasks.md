## 1. Failing reproduction (real Postgres)

- [x] 1.1 The unit/integration suites use the in-memory store branch (`pgClient._workspaceSubQuotas !== undefined`) and cannot reproduce this SQL bug. The reproduction is the real-stack HTTP slice: `tests/env/e2e-smoke/run.sh` step [31] (tenant_owner sub-quota set) and the Playwright `workspace-sub-quota-http-slice.spec.ts` "within the tenant limit" test.
- [x] 1.2 Confirmed RED before the fix: booting the `tests/env` stack against real Postgres and POSTing `/v1/workspace-sub-quotas` returns HTTP 500 `{"code":"SHIM_ERROR","message":"FOR UPDATE is not allowed with aggregate functions"}`.

## 2. Fix repository layer

- [x] 2.1 In `services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs::getTotalAllocatedExcluding`: relocate `FOR UPDATE` onto a non-aggregate inner subquery selecting the sibling rows, and apply `SUM(...)` in the outer query. Leave the in-memory-store branch and `upsertSubQuota` (SERIALIZABLE tx + limit comparison) unchanged.

## 3. Verify (real Postgres)

- [x] 3.1 Booted `tests/env` and ran `bash tests/env/e2e-smoke/run.sh` — steps [31]-[34] GREEN: set within limit -> 201 (was 500), over-limit (999 > 50) -> 422, cross-tenant -> 403, list -> 200 includes the allocation.
- [x] 3.2 Full Playwright slice (`npx playwright test` in `tests/env/e2e-smoke`) — 29 passed, including all 5 `workspace-sub-quota-http-slice.spec.ts` cases.
- [x] 3.3 `bash tests/blackbox/run.sh` at repo root — 271 pass / 0 fail (no regressions; suite does not exercise the pg path). Also `node --test tests/integration/105-effective-limit-resolution/*.test.mjs` — 20 pass (these use the in-memory store branch, untouched by the fix).
