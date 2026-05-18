## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/quota-engine.test.mjs` proving (a) `quota-audit-query` with `dimensionKey=X` excludes override events for dimension `Y` (B2.1), (b) concurrent `workspace-sub-quota` upserts in the in-memory branch reject the second writer (B2.2), (c) `quota-override-expiry-sweep` invoked twice with `batchSize=10` against 25 expired rows processes all 25 across the two invocations (B2.3), and (d) `tenant-effective-entitlements-get` emits a `consumption_timed_out` log entry when consumption fetch exceeds 500ms (G14).

## 2. Implementation

- [ ] 2.1 [migration] Add migration adding `dimension_key` column to the override-events table and an FK from `quota_overrides`/`workspace_sub_quotas` to `tenants`/`workspaces` (`ON DELETE CASCADE`) (G11).
- [ ] 2.2 [fix] Update `services/provisioning-orchestrator/src/actions/quota-audit-query.mjs:9` to apply `dimensionKey` against both enforcement logs and the newly-tagged override events.
- [ ] 2.3 [fix] Add a per-tenant async mutex (or rejecting promise queue) around the in-memory branch of `services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs:50` so the `getTotalAllocatedExcluding+push` pair is critical-section.
- [ ] 2.4 [fix] Rewrite `services/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs` to advance a `(expires_at,id)` cursor and bound by max iterations rather than break-after-batch.
- [ ] 2.5 [fix] Replace silent fallback in `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` consumption-timeout path with a structured `tenant.entitlements.consumption_timed_out` log entry plus the `unknown` status return.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/quota-engine.test.mjs` and `openspec validate fix-c1-quota-engine --strict`; both green before merge.
