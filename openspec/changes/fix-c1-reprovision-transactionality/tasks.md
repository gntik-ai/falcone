## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/reprovision.test.mjs` proving (a) a failure in the third applier rolls back the first two and records per-domain `rolled_back` (B4.1), (b) a lock-release failure transitions the lock to a fenced state and blocks new acquires for the full TTL (B4.2), (c) `validate` with `strict=true` returns `result='invalid'` on schema-checksum mismatch (B4.3), and (d) the migration-chain validator rejects a version not present in the registry (G19).

## 2. Implementation

- [ ] 2.1 [fix] Define an applier compensation API: each applier exports `apply()` and `undo(applyResult)`. Update all files under `services/provisioning-orchestrator/src/appliers/` to implement `undo()` or explicitly opt out via `compensable: false`.
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/actions/reprovision.mjs:208-262`, replace the sequential apply loop with one that records each `apply()` outcome and, on failure of any subsequent domain, invokes `undo()` in reverse order. Persist per-domain outcomes (`applied|rolled_back|rollback_failed`) in `config_reprovision_audit_log`.
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/actions/reprovision.mjs:327,256-261`, propagate Postgres errors from lock release and `failLock`; on release failure, set the lock row to `lock_state='broken'` so a subsequent acquire respects the full TTL instead of races.
- [ ] 2.4 [fix] In `services/provisioning-orchestrator/src/actions/validate.mjs:105-109`, add a `strict` flag (default `true` when invoked from `reprovision`); on `strict=true` return `result='invalid'` for `schema_checksum_match=false`.
- [ ] 2.5 [fix] Add a no-op `v1.0.0 -> v1.0.0` entry in `services/provisioning-orchestrator/src/schemas/migrations/` so the chain validator has a non-empty registry; future schema bumps without a migration entry MUST fail loudly.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/reprovision.test.mjs` and `openspec validate fix-c1-reprovision-transactionality --strict`; both green before merge.
