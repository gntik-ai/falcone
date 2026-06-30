# Change: fix-765-audit-record-filters

## Why

The Observability Audit tab sends audit-record filter query parameters, but the kind
control-plane handler dropped every `filter[...]` value before querying
`plan_audit_events`. Operators filtering to failed actions, a specific actor, an action
category, or a time window received the same mixed tenant audit set while the console
appeared to have applied the filter.

## What Changes

- Parse `filter[outcome]`, `filter[actionCategory]`, `filter[actorId]`,
  `filter[occurredAfter]`, and `filter[occurredBefore]` in the metrics audit-records handler.
- Pass those filters into the audit store query alongside the already enforced tenant,
  workspace, and limit constraints.
- Apply filters as parameterized SQL predicates before ordering/limiting, so unmatched values
  return an empty page rather than the full audit set.
- Derive an audit `action.category` projection from stored action metadata/action type, and allow
  `filter[actionCategory]` to match either the derived category or the stored action type for the
  existing kind audit rows.
- Extend the black-box audit writer/scope test with the issue scenarios for outcome,
  actionCategory, actorId, and time-range filters, including tenant-scope preservation.
- Document the supported audit-record filters in the public API surface reference.

## Impact

- Backend/runtime:
  - `deploy/kind/control-plane/metrics-handlers.mjs`
  - `deploy/kind/control-plane/audit-store.mjs`
- Frontend:
  - No change. `apps/web-console/src/lib/console-metrics.ts` already sends the declared
    `filter[...]` query parameters.
- Contract:
  - No source contract change. The filters already exist in
    `services/internal-contracts/src/observability-audit-query-surface.json` and generated OpenAPI;
    this change makes the runtime honor that wire contract.
- Tests:
  - `tests/blackbox/audit-write-and-scope-enforcement.test.mjs`
- Docs/OpenSpec:
  - `docs/reference/architecture/observability-audit-record-filters.md`
  - this OpenSpec change under `openspec/changes/fix-765-audit-record-filters/`

## Non-Goals

- No live deployment or browser verification in this run. The active Kubernetes context is not a
  local kind test cluster, and the issue instructions prohibit mutating it.
- No new public API parameters or generated client changes; the existing contract already declares
  the affected query parameters.
