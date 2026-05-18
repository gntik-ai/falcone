## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/async-retry-harden.test.mjs` proving (a) `async-operation-transition` picks up a new mapping within the TTL window of an `invalidate()` (B3.4), (b) two concurrent `findOrInsert` calls landing at the exact expiry boundary do not both observe `active` (B3.5), and (c) every operation recovered by `async-operation-orphan-sweep` has a corresponding `retry_attempts` row with `source='orphan_sweep'` (B3.6).

## 2. Implementation

- [ ] 2.1 [fix] In `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs:14-30`, add a 60s TTL to the `failure_code_mappings` cache and expose an `invalidate()` triggered by an `mappings_updated` Kafka event consumer (registered at process start).
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/repositories/idempotency-key-repo.mjs:20-34`, replace the find-then-insert pair with `INSERT … ON CONFLICT (key) DO NOTHING RETURNING *`; treat `RETURNING` empty as "row exists, refetch under the same txn".
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs:31-44`, insert a synthetic `retry_attempts` row with `source='orphan_sweep'` (extend the source enum if needed) for each recovered operation.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/async-retry-harden.test.mjs` and `openspec validate harden-c1-async-operation-retry --strict`; both green before merge.
