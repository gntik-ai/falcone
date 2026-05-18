## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/async-operation-state.test.mjs` proving (a) `async-operation-retry-override` against a `completed` operation returns 409 and does not reset status (B3.1), (b) a simulated race where `atomicResetToRetry` returns null leaves no orphan `retry_attempts` row (B3.2), and (c) two concurrent transitions to `manual_intervention_required` produce one inserted flag row but both emit `…manual-intervention-required` events for the same `correlation_id` (B3.3).

## 2. Implementation

- [ ] 2.1 [fix] In `services/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs:52`, add `AND status IN ('failed','manual_intervention_required')` to the UPDATE; return 409 with `INVALID_STATE_FOR_OVERRIDE` when zero rows are affected.
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs:44-49`, move the `retry_attempts` insert below `atomicResetToRetry`; wrap both in a single transaction so the attempt row only exists when the reset succeeded.
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs:91-96`, replace the warn-log on UNIQUE_VIOLATION with a fetch of the existing flag row and an idempotent re-emit of `…manual-intervention-required` keyed on `correlation_id`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/async-operation-state.test.mjs` and `openspec validate fix-c1-async-operations --strict`; both green before merge.
