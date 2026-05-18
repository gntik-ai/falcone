## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/repositories/plan-assignment.test.mjs` proving (a) `setLocalLockTimeout` rejects non-numeric inputs without reaching the database (B1.4), and (b) a simulated failure on the second impact-insert rolls back the supersede and all prior impact rows (B1.5).

## 2. Implementation

- [ ] 2.1 [fix] In `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs:29`, replace string interpolation of `resolveLockTimeoutMs()` with a parameterised `SET LOCAL lock_timeout` via `pg-format` or a `current_setting('app.lock_timeout_ms')::int * '1 ms'::interval` pattern.
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs:87-92`, wrap the impact-insert loop inside the same transaction as the supersede; on any failure, abort the entire assignment write.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/repositories/plan-assignment.test.mjs` and `openspec validate harden-c1-plan-assignments --strict`; both green before merge.
