## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/internal-contracts/test/plan-change-quota.test.mjs` with a case
      where `fromPlan` declares a `storage_bytes` quota and `toPlan` does not;
      assert `quotaDelta[]` reports `storage_bytes` in a new `removedMetrics`
      list rather than silently dropping it.
- [ ] 1.2 [test] Add a case where `toPlan` has no `quotaPolicyId`; assert the
      result MUST be `status: 'requires_remediation'` with `reasonCode:
      'QUOTA_POLICY_MISSING'` — not `'compatible'`.
- [ ] 1.3 [test] Spy on `getCommercialPlan` and call `evaluatePlanChange`;
      assert the spy is invoked at most once per plan id.

## 2. Implementation

- [ ] 2.1 [fix] Extend the loop at `index.mjs:1745-1755` to also walk
      `fromQuotaLimits.entries()`; populate `removedMetrics[]` for keys
      present only in `from`.
- [ ] 2.2 [fix] In `evaluatePlanChange` reject the call early when either
      plan's `quotaPolicyId` is undefined; return `status:
      'requires_remediation'` with `reasonCode: 'QUOTA_POLICY_MISSING'`.
- [ ] 2.3 [fix] Reuse the `commercialPlan` instances already returned from
      `resolveTenantEffectiveCapabilities`; remove the redundant
      `getCommercialPlan(fromPlanId)` / `getCommercialPlan(toPlanId)` calls
      at `index.mjs:1738-1739`.

## 3. Validation

- [ ] 3.1 [docs] Document `removedMetrics[]` and `QUOTA_POLICY_MISSING` in
      `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry unit suite plus `openspec validate
      fix-o2-plan-change-quota-drift --strict`; both green.
