## Why

The contracts declare degraded probe states, evidence-degraded
suppression, and a terminal `suppressed` alert state — but no runtime
projects, gates, or guards any of them. From
`openspec/audit/cap-m4-observability-metrics.md`:

- **B9** (`services/internal-contracts/src/observability-health-checks.json:32-36,
  :172-176`) — the `allowed_statuses` list includes `degraded`; the
  `status_value_model` maps `{success: 1, failure: 0, unknown: -1}` with
  no entry for `degraded`. Prometheus consumers that project
  `component_probe_status` numerically have no way to represent
  degraded.
- **B10** (`services/internal-contracts/src/observability-threshold-alerts.json:54-64`)
  — `suppression_causes = {evidence_degraded, evidence_unavailable}` is
  declared but no code enforces it. Alerts fire on degraded evidence as
  if it were fresh.
- **B16** (`services/internal-contracts/src/observability-console-alerts.json:218-250`)
  — `suppressed` is documented as a terminal state in the alert
  lifecycle, but no state-machine guard prevents code from attempting
  `suppressed → acknowledged` or `suppressed → resolved`. Transitions
  away from `suppressed` succeed silently and corrupt the lifecycle.
- **G-S4.1** — `degraded` probe status not in the numeric value model.
- **G-S6.1/G-S6.2** — suppression on degraded evidence is contract-only;
  escalation order vs posture precedence reversed (covered by
  `harden-m4-audit-context-and-recorders` for the recorder side).
- **G-S7.2** — `suppressed → ?` transitions undefined.

## What Changes

- Extend the `status_value_model` in `observability-health-checks.json`
  to include `degraded: 0.5`, and update the recorder's projection of
  `component_probe_status` to emit the numeric mapping consistently.
- Add a `SuppressionGate` to the threshold-alert emitter that checks the
  evidence-freshness label on every alert candidate; if freshness is in
  `{degraded, unavailable}`, the alert is suppressed (not emitted) and a
  `suppression_count` counter is incremented for operator visibility.
- Add an explicit alert-state-machine guard at every
  `alerts.update(state)` site that rejects any transition out of
  `suppressed`. The guard returns 409 to handlers and logs a structured
  warning identifying the call site.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on a numeric projection for
  `degraded`, on runtime suppression for alerts on degraded evidence,
  and on a state-machine guard preventing transitions out of the
  terminal `suppressed` state.

## Impact

- **Affected code**:
  `services/internal-contracts/src/observability-health-checks.json`
  (value-model addition);
  `services/metrics-runtime/src/health-probe-projection.mjs` (numeric
  emit); `services/metrics-runtime/src/emitter.mjs` (SuppressionGate);
  `services/console-alerts-engine/src/state-machine.mjs` (guard); the
  three audit-emit sites and the alert-write sites identified by grep.
- **Migration required**: none for data; dashboards consuming
  `component_probe_status` should be updated to recognise the new
  `0.5` value (additive — backward-compatible numerically).
- **Breaking changes**: alerts that previously fired on degraded
  evidence will be suppressed instead; on-call documentation should
  reference the new suppression counter to verify behaviour.
- **Cross-cutting**: depends on `complete-m4-metrics-handlers` for the
  emitter / recorder where the gates and projections live; complements
  `harden-m4-audit-context-and-recorders` for the audit-context fields
  the suppression event carries.
