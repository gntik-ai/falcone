## 1. Failing tests

- [ ] 1.1 [test] Add `services/metrics-runtime/test/label-allowlist.test.mjs`
      that asserts `recorder.counter('x').inc({user_id: 'u1'})` throws
      synchronously with a message naming `user_id` (proves B11).
- [ ] 1.2 [test] Add `services/metrics-runtime/test/alert-scrub.test.mjs`
      that asserts `emitter.emitConsoleAlert({password: 'p'})` throws
      synchronously with a message naming `password`, and that the
      forbidden field never appears in any audit-topic message published
      under test (proves B12).
- [ ] 1.3 [test] Add `services/provisioning-orchestrator/test/threshold-ordering.test.mjs`
      that asserts `validateThresholdOrdering(90, 80, 70)` throws and
      `validateThresholdOrdering(70, 80, 90)` returns OK; assert the
      policy-writer rejects the inverted set with a clear error (proves
      B13).
- [ ] 1.4 [test] Add `services/metrics-runtime/test/observation-window.test.mjs`
      that asserts `assertObservationWindow('2026-05-18T12:00:00Z',
      '2026-05-18T11:00:00Z')` throws and the inverse passes (proves B15).

## 2. Implementation

- [ ] 2.1 [impl] Add `enforceLabelAllowlist(labels)` to
      `services/metrics-runtime/src/recorder.mjs`; the allowlist is
      compiled from `observability-metrics-stack.json:86-95` at module
      load; every metric-recording method invokes the guard.
- [ ] 2.2 [impl] Add `scrubAlertPayload(payload)` to
      `services/metrics-runtime/src/emitter.mjs`; the forbidden set is
      compiled from `observability-console-alerts.json:411-422`; the
      function throws on any forbidden key rather than silently dropping.
- [ ] 2.3 [impl] Add
      `services/provisioning-orchestrator/src/quota/threshold-validator.mjs`
      exporting `validateThresholdOrdering(warning, soft, hard)`; invoke
      it from every policy-write site identified by `grep -l
      "UPDATE quota_policies\|INSERT INTO quota_policies"`.
- [ ] 2.4 [impl] Add
      `services/metrics-runtime/src/observation-window.mjs` exporting
      `assertObservationWindow(startedAt, endedAt)`; invoke it from
      every snapshot-write site identified by `grep -l
      "INSERT INTO usage_snapshots"`.
- [ ] 2.5 [migration] Add a one-shot data audit at
      `migrations/0NN-quota-policy-ordering-audit.sql` that lists rows
      violating `warning ≤ soft ≤ hard` so operators can fix them before
      the runtime check rejects future writes.

## 3. Validation

- [ ] 3.1 [docs] Document the four guards in
      `services/metrics-runtime/README.md` with the contract source
      file:line for each.
- [ ] 3.2 [test] Run `corepack pnpm test:unit` and
      `openspec validate fix-m4-invariant-enforcement --strict`; both
      green before merge.
