## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/operations/restore-simulation.types.test.ts`
      asserting `isSafeSimulationProfile('integration-prod')` returns
      `false`; assert `isSafeSimulationProfile('integration')` returns
      `true`; assert `isSafeSimulationProfile('integrationcd')` returns
      `false`.
- [ ] 1.2 [test] Add a case to
      `services/backup-status/src/prechecks/snapshot-exists.precheck.test.ts`
      where `adapterClient = null`; assert the result is
      `blocking_error`, not `ok`.
- [ ] 1.3 [test] Add a case to
      `services/backup-status/src/prechecks/active-connections.precheck.test.ts`
      where the adapter throws an `EADAPTERDOWN`; assert the result is
      `blocking_error`, not `warning`.
- [ ] 1.4 [test] Add a case to `collector.action.test.ts` asserting that
      an adapter exception produces a structured log line carrying
      `componentType`, `instanceId`, and the original error message.

## 2. Implementation

- [ ] 2.1 [fix] In
      `operations/restore-simulation.types.ts:50-53` replace the
      `.includes()` branch with `normalized === allowed`; remove the
      substring arm.
- [ ] 2.2 [fix] In `prechecks/snapshot-exists.precheck.ts:17-23` return
      `{ status: 'blocking_error', code: 'adapter_unavailable' }` when
      `adapterClient` is null or undefined.
- [ ] 2.3 [fix] In `prechecks/active-connections.precheck.ts:46-52`
      distinguish "zero connections" (warning/ok) from "adapter error"
      (blocking_error); preserve the original error code in the result.
- [ ] 2.4 [fix] In `collector/collector.action.ts:67-69` log
      `{ componentType, instanceId, error: err.message }` at warn level
      before setting `status: 'not_available'`.

## 3. Validation

- [ ] 3.1 [test] Re-run the L1 unit suite and `openspec validate
      fix-l1-simulation-and-precheck-fail-open --strict`; both green.
- [ ] 3.2 [docs] Update the simulation-profile allow-list section of
      `services/backup-status/README.md` to call out strict equality.
