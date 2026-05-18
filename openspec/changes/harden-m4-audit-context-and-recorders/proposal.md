## Why

Four cross-contract inconsistencies leak into the recorder/emitter
layer: escalation order disagrees with posture precedence, the
workspace-fallback policy differs by subsystem, business-metric
attribution is operationally undefined, and health priorities live in
the wrong contract. From `openspec/audit/cap-m4-observability-metrics.md`:

- **B17** (`services/internal-contracts/src/observability-quota-policies.json:149-157`
  vs `observability-threshold-alerts.json:111-119`) — quota-policies
  declares posture precedence `hard_limit_reached > soft_limit_exceeded
  > warning > evidence_unavailable > evidence_degraded > within_limit >
  unbounded`; threshold-alerts declares escalation `warning →
  soft_limit → hard_limit` (reverse for recovery). When posture
  changes by more than one step in a single evaluation cycle, the two
  orderings disagree on which alert(s) to emit.
- **B18** (`services/internal-contracts/src/observability-dashboards.json:155,
  :323`) — most subsystems use `workspace_fallback: tenant_inherited`;
  the control-plane subsystem alone uses `workspace_native`. No
  validator checks dashboard code respects per-subsystem fallback;
  rendering code may pick one and silently mis-attribute the other
  subsystems.
- **B19** (`services/internal-contracts/src/observability-business-metrics.json:364`)
  — `api_requests_total` declares `safe_attribution_policy =
  "workspace_safe_when_route_context_is_attributable"`. The word
  "attributable" is not defined; emitters and dashboards may disagree
  on the predicate.
- **B20** (`services/internal-contracts/src/observability-console-alerts.json:103-132`)
  — health-summary aggregation priorities `{healthy: 50, degraded: 40,
  unavailable: 10, stale: 20, unknown: 30}` are declared in
  console-alerts, but the natural home is `observability-health-checks.json`.
  Cross-contract leakage forces health-check consumers to read an
  alerts contract.
- **G-S5.1/G-S5.2** — `audit_context` enforcement and
  `safe_attribution_policy` operational meaning unspecified.

## What Changes

- Reconcile B17 by adding a `transitionEmissionOrder` field to
  `observability-threshold-alerts.json` that walks posture changes by
  using the quota-policies precedence as the canonical order: on a
  multi-step posture change `previous → new`, emit one alert per
  intermediate posture in precedence order. The escalation/recovery
  arrows become an implementation detail of the walk.
- Define `safe_attribution_policy` operationally as
  `route_context.workspace_id IS NOT NULL AND
  route_context.workspace_id matches request.workspace_header` and
  embed the predicate in `observability-business-metrics.json` so
  emitters and dashboards share the definition.
- Move the health-aggregation priorities to
  `observability-health-checks.json` (canonical home);
  `observability-console-alerts.json` keeps a reference comment
  pointing at the new location. Add a cross-contract validator
  assertion (extending the one from
  `fix-m4-quota-vocabulary-alignment`) that the priorities live only
  in the health-checks contract.
- Enforce `audit_context` required fields at the emitter: every
  business-metric emit MUST carry `{actor_id, dashboard_scope,
  tenant_id, workspace_id, metric_family_id, correlation_id}`; missing
  fields throw synchronously.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on a single canonical
  posture-precedence walk for alert emission, on an operational
  definition of `safe_attribution_policy`, on health-aggregation
  priorities living in the health-checks contract, and on emitter-side
  enforcement of `audit_context` required fields.

## Impact

- **Affected code**:
  `services/internal-contracts/src/observability-threshold-alerts.json`
  (`transitionEmissionOrder` field),
  `observability-business-metrics.json` (operational predicate),
  `observability-health-checks.json` (priorities moved in),
  `observability-console-alerts.json` (priorities removed, comment
  reference added);
  `services/metrics-runtime/src/emitter.mjs` (audit-context guard);
  the cross-contract validator from `fix-m4-quota-vocabulary-alignment`
  extended to detect priority-placement drift.
- **Migration required**: dashboards that read priorities from
  `console-alerts.json` must move to `health-checks.json` (same
  values, different file).
- **Breaking changes**: emitters that currently omit
  `audit_context.correlation_id` will throw; this is the intended
  behaviour and forces correlation-id propagation across the
  business-metric path.
- **Cross-cutting**: depends on `complete-m4-metrics-handlers` for the
  emitter layer and on `fix-m4-quota-vocabulary-alignment` for the
  cross-contract validator infrastructure to extend.
