## 1. Failing tests

- [ ] 1.1 [test] Add `services/metrics-runtime/test/transition-emission-order.test.mjs`
      that asserts a posture change `within_limit → hard_limit_reached`
      emits three alerts in canonical precedence order (warning, soft,
      hard) keyed by the new `transitionEmissionOrder` field — and that
      a recovery `hard_limit_reached → within_limit` walks the reverse
      (proves B17).
- [ ] 1.2 [test] Add `tests/contracts/workspace-fallback-validator.test.mjs`
      that asserts the cross-contract validator detects a synthetic
      dashboard contract where the control-plane subsystem changes from
      `workspace_native` to `tenant_inherited` (proves B18's drift
      detection).
- [ ] 1.3 [test] Add `services/metrics-runtime/test/audit-context-guard.test.mjs`
      that asserts `emitter.emitBusinessMetric({...})` throws when any
      of `actor_id, dashboard_scope, tenant_id, workspace_id,
      metric_family_id, correlation_id` is missing (proves audit-context
      enforcement and the operationalised `safe_attribution_policy`
      from B19).
- [ ] 1.4 [test] Add `tests/contracts/health-priority-placement.test.mjs`
      that asserts the health-aggregation priorities are present in
      `observability-health-checks.json` and absent from
      `observability-console-alerts.json` (proves B20).

## 2. Implementation

- [ ] 2.1 [fix] Edit
      `services/internal-contracts/src/observability-threshold-alerts.json:111-119`
      to add `transitionEmissionOrder` referencing the quota-policies
      precedence; document the multi-step walk in the contract
      description.
- [ ] 2.2 [fix] Edit
      `services/internal-contracts/src/observability-business-metrics.json:364`
      to add the operational predicate
      `attributable_when: "route_context.workspace_id IS NOT NULL AND
      route_context.workspace_id == request.workspace_header"` next to
      `safe_attribution_policy`.
- [ ] 2.3 [fix] Move the health-aggregation priorities block from
      `observability-console-alerts.json:103-132` to
      `observability-health-checks.json`; leave a `priorities_moved_to:
      "observability-health-checks.json"` comment in console-alerts.
- [ ] 2.4 [impl] In `services/metrics-runtime/src/emitter.mjs`, add
      `assertAuditContext(payload)` that throws synchronously when any
      of the six required fields is missing; invoke it from every
      business-metric emit path.
- [ ] 2.5 [impl] Extend
      `scripts/lib/observability-cross-contract.mjs` (from
      `fix-m4-quota-vocabulary-alignment`) with two new checks:
      (a) priorities live only in `observability-health-checks.json`,
      (b) per-subsystem `workspace_fallback` values in
      `observability-dashboards.json` match a declared allowlist.

## 3. Validation

- [ ] 3.1 [docs] Update
      `services/internal-contracts/src/README.md` (or the canonical
      vocabulary section added by
      `fix-m4-quota-vocabulary-alignment`) with the operational
      `safe_attribution_policy` predicate and the
      priority-placement rule.
- [ ] 3.2 [test] Run `corepack pnpm test:unit`, the contract suite, and
      `openspec validate harden-m4-audit-context-and-recorders --strict`;
      all green before merge.
