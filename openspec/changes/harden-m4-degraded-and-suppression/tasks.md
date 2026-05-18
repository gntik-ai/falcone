## 1. Failing tests

- [ ] 1.1 [test] Add `services/metrics-runtime/test/health-probe-projection.test.mjs`
      that asserts a probe in status `degraded` emits
      `component_probe_status = 0.5`, success → 1, failure → 0, unknown
      → -1 (proves B9 has a numeric projection for every allowed status).
- [ ] 1.2 [test] Add `services/metrics-runtime/test/suppression-gate.test.mjs`
      that asserts an alert candidate with `evidence_freshness:
      'degraded'` is suppressed (no audit-topic message), the
      `quota_alert_suppression_total` counter is incremented, and the
      same candidate with `evidence_freshness: 'fresh'` is emitted
      (proves B10).
- [ ] 1.3 [test] Add `services/console-alerts-engine/test/state-guard.test.mjs`
      that asserts `transitionAlert(alertId, 'suppressed', 'acknowledged')`
      throws or returns 409 and that the alert row remains in
      `suppressed` (proves B16).
- [ ] 1.4 [test] Add a case asserting `transitionAlert(alertId, 'active',
      'suppressed')` succeeds (suppression-entry is still valid).

## 2. Implementation

- [ ] 2.1 [fix] Edit
      `services/internal-contracts/src/observability-health-checks.json:172-176`
      to add `degraded: 0.5` to the `status_value_model`; bump the
      contract version.
- [ ] 2.2 [impl] Add `services/metrics-runtime/src/health-probe-projection.mjs`
      that maps probe status strings to the numeric value model and
      emits via the recorder; call it from every probe collector.
- [ ] 2.3 [impl] Add `SuppressionGate` to
      `services/metrics-runtime/src/emitter.mjs`: every threshold-alert
      emit passes through the gate; the gate reads
      `evidence_freshness` from the candidate and short-circuits with a
      counter increment when in `{degraded, unavailable}`.
- [ ] 2.4 [impl] Add a state-machine guard at
      `services/console-alerts-engine/src/state-machine.mjs` that
      rejects any transition whose `from === 'suppressed'`; return 409
      to handlers and emit a structured log line with the call site.
- [ ] 2.5 [impl] Wire the new `quota_alert_suppression_total` counter
      into the recorder so on-call can observe suppression activity in
      Prometheus.

## 3. Validation

- [ ] 3.1 [docs] Document the suppression behaviour, the new counter,
      and the terminal-state guard in
      `services/console-alerts-engine/README.md` and in
      `services/metrics-runtime/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:unit` and
      `openspec validate harden-m4-degraded-and-suppression --strict`;
      both green before merge.
