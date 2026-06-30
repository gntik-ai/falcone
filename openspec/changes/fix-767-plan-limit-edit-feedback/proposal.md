## Why

The superadmin plan-detail Limits editor (`/console/plans/{planId}`) showed a rejected
plan-limit value as if it had been saved. The page fired `setPlanLimit` and
`removePlanLimit` without awaiting either request, then optimistically rewrote the local
profile. When the API rejected invalid values such as `1.5` or `-5` with
`INVALID_LIMIT_VALUE`, the console showed no error and left the rejected value visible until
reload. Reset also left a stale editable input because the table used uncontrolled
`defaultValue` and the profile API's authoritative value is `effectiveValue`, not the old
local `defaultValue` field.

This is a web-console reconciliation bug. The backend already rejects invalid values and
returns accepted write results; the console must wait for those results and prefer the
reloaded limits profile over invented local state.

## What Changes

- `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`
  - Awaits `setPlanLimit` and `removePlanLimit`.
  - Shows explicit success/error feedback on the Limits tab.
  - Never marks a rejected value as saved.
  - Reconciles successful writes from the accepted API response and then refreshes
    `getPlanLimitsProfile`, preferring the refreshed profile where available.
  - Refetches or re-emits the last profile after failures so edited inputs are restored to
    persisted values.
- `apps/web-console/src/components/console/PlanLimitsTable.tsx`
  - Changes plan-limit inputs from uncontrolled `defaultValue` inputs to controlled draft
    inputs that reset from refreshed `dimensions` props.
  - Disables the active row while its write/reset is in flight.
- `apps/web-console/src/services/planManagementApi.ts`
  - Types the actual plan-limit write response bodies (`newValue`/`source` for PUT and
    `effectiveValue`/`source` for DELETE).
  - Treats `defaultValue`/`explicitValue` on `LimitProfileRow` as optional legacy fields;
    console editing uses `effectiveValue`.
- Tests
  - Add focused web-console tests for rejected edits, successful edit reconciliation, reset
    reconciliation without reload, and table prop-driven input reset.
- Docs
  - Add a reference architecture note for plan-limit edit feedback and reconciliation.
- Contract/codegen
  - No public route, status code, request body, or response-body contract changes are
    required. The frontend now consumes the existing API contract; no OpenAPI/route
    catalog/SDK codegen changes are expected.

## Capabilities

### Modified Capabilities

- `web-console`: plan-limit edits on the superadmin plan detail page await API writes,
  surface explicit success/error feedback, and display only accepted or persisted values.
- `quotas-plans`: the existing plan-limit write/read API fields used for reconciliation are
  documented as the contract the console consumes.
