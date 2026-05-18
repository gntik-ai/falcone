## Why

`evaluatePlanChange` is the registry function callers rely on to decide whether
a plan migration is safe. Today it lies about three distinct cases. From
`openspec/audit/cap-o2-internal-contracts.md`:

- **B11** (`services/internal-contracts/src/index.mjs:1745-1755`) — the loop
  walks only `toQuotaLimits.entries()`. Quota dimensions present in `fromPlan`
  but absent in `toPlan` are silently dropped from `quotaDelta`. A downgrade
  that removes a quota dimension entirely shows as "no removed dimension".
- **B12** (`services/internal-contracts/src/index.mjs:1738-1739, :1071-1073`) —
  when either plan has no quota policy, `indexQuotaLimits(undefined)` yields an
  empty Map; the loop iterates zero times; `blockingMetrics` stays empty;
  status returns `'compatible'`. Plans missing a quota policy pass the gate
  regardless of current usage.
- **B19** (`services/internal-contracts/src/index.mjs:1738-1739`) —
  `evaluatePlanChange` calls `getCommercialPlan(fromPlanId)` and
  `getCommercialPlan(toPlanId)` after `resolveTenantEffectiveCapabilities` has
  already resolved both. Redundant lookups widen the TypeError surface and
  re-pay parse cost.
- **G9** restates B11 with the same line citation.

## What Changes

- Walk both `fromQuotaLimits` and `toQuotaLimits` when building `quotaDelta`;
  emit `removedMetrics[]` entries for metrics present only in `from`.
- Reject the call with `reasonCode: 'QUOTA_POLICY_MISSING'` when either plan
  lacks a quota policy; do not return `'compatible'` by accident.
- Reuse the `commercialPlan` lookups already resolved inside
  `resolveTenantEffectiveCapabilities` rather than re-calling
  `getCommercialPlan`.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on plan-change evaluator —
  bidirectional quota diff, fail-closed on missing quota policy, no redundant
  registry lookups.

## Impact

- **Affected code**: `services/internal-contracts/src/index.mjs:1733-1767` and
  the `indexQuotaLimits` helper at `:1071-1073`.
- **Migration required**: none.
- **Breaking changes**: callers that relied on the silent `'compatible'` for
  plans without quota policies will now see `'requires_remediation'` with
  `QUOTA_POLICY_MISSING`. Intended.
