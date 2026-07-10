## Why

Issue #769 confirmed that the superadmin plan detail Limits editor was too implicit for
live entitlement changes: values saved on blur, decimal drafts could reach the API, row
save state was not explicit, and Reset deleted the explicit plan limit immediately with
no confirmation or affected-tenant warning. The same issue also requires the console
shell to keep a route-level render-error boundary; that boundary already exists on this
baseline and is preserved by this change.

## What Changes

- `PlanLimitsTable` becomes an explicit draft editor:
  - controlled inputs remain reconciled from the refreshed plan-limit profile;
  - Save is the visible commit affordance for each row;
  - blur no longer commits a mutation;
  - each row shows persisted/unsaved/saving/saved/failed state;
  - integer validation rejects empty, decimal, non-finite, and `< -1` drafts before any
    API call.
- `ConsolePlanDetailPage` owns row mutation state, reconciles rows from the accepted
  `PUT`/`DELETE` responses and refreshed `GET /v1/plans/{planId}/limits`, and opens the
  shared destructive confirmation dialog before Reset.
- The Limits tab shows an active-vs-draft indicator. Active plans include the active
  assignment count, and the Reset confirmation repeats the affected-tenant warning.
- Existing route-level shell error-boundary coverage is retained through
  `RouteErrorBoundary.test.tsx`; no router or backend contract change is required.
- Documentation for plan-limit editing is updated to describe explicit Save, integer
  validation, row status, reset confirmation, and live-plan impact.

## Non-Goals

- No backend, OpenAPI, route catalog, generated SDK/client, or shared type changes.
- No changes to plan lifecycle semantics, quota enforcement, tenant plan assignment, or
  the `/console/quotas` adjustment flow.
- No broad redesign of the Plans surface beyond the Limits editor behaviors required by
  issue #769.

## Exit Criteria

- A `/console/*` render error is still contained inside the shell content area by a
  route-level `errorElement`.
- Editing a plan limit creates a visible unsaved draft and does not call the API until
  Save is used.
- Decimal drafts are rejected locally and do not call `setPlanLimit`.
- Each row exposes saving/saved/failed state and reconciles to the true persisted value
  after successful Save or Reset.
- Reset opens the shared confirmation dialog before `removePlanLimit` is called, and the
  dialog names affected tenants for an active assigned plan.
- Focused web-console tests and `openspec validate add-769-plan-limits-editor --strict`
  pass.

## Risks and Rollback

This is a frontend-only behavior change over existing API endpoints. The main risk is a
regression in keyboard or screen-reader affordances around the row actions; it is
mitigated by keeping standard buttons/inputs, explicit accessible names, row status text,
and existing destructive-confirmation composition. Rollback is to restore the previous
blur-save table and direct Reset callback, with no backend or persisted data migration.

## Capabilities

### Modified Capabilities

- `web-console`: ADDED requirements for shell-preserving console render-error handling
  and editor-grade plan Limits editing on `/console/plans/:planId`.
