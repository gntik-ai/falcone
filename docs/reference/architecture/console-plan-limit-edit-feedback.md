# Console plan-limit edit feedback and reconciliation

The superadmin plan detail page (`/console/plans/{planId}`) lets platform operators edit
plan quota dimensions from the **Limits** tab. That editor must treat the control-plane
API as the source of truth: a typed value is only a saved limit after the operator clicks
**Guardar** and the API accepts it.

## Write flow

The page uses the plan management API client
(`apps/web-console/src/services/planManagementApi.ts`) against these existing routes:

- `PUT /v1/plans/{planId}/limits/{dimensionKey}` with `{ value }`
- `DELETE /v1/plans/{planId}/limits/{dimensionKey}`
- `GET /v1/plans/{planId}/limits`

On PUT success, the backend returns the accepted `newValue` and `source`. On DELETE
success, it returns the reverted `effectiveValue` and `source`. The console applies that
accepted response as a short-lived reconciliation bridge, then refreshes
`GET /v1/plans/{planId}/limits` and prefers the returned profile for the row shown in the
table.

The editable table is an explicit draft editor:

- Typing in a row creates a local draft and marks that row as `Cambio sin guardar`.
- Leaving the field does not save. The row is persisted only through the row's
  **Guardar** button or Enter key while the draft is valid.
- Each row shows its own status: persisted, unsaved, saving, saved, or failed.
- Values must be integers greater than or equal to `-1`; `-1` means unlimited. Decimal
  drafts such as `1.5`, empty drafts, and values below `-1` are rejected client-side and
  never call `PUT /v1/plans/{planId}/limits/{dimensionKey}`.

## Failure flow

Backend-rejected values or frozen-plan writes are not persisted. The console awaits the
write, shows an explicit error on the Limits tab, marks the affected row as failed, and
refreshes (or re-emits) the last profile so the editable input returns to the last
persisted `effectiveValue`. It must not set `source: explicit` or display the rejected
number as a saved limit.

Other write failures follow the same rule: surface the error, do not run success feedback,
and do not display a failed value as saved. For frozen plans, `PLAN_LIMITS_FROZEN` is shown
as a plan state problem rather than silently changing the row.

## Table input rule

`PlanLimitsTable` keeps a local draft string while the operator is typing, but the visible
input is reset whenever the parent passes a refreshed `dimensions` profile. This matters
because the authoritative profile rows expose the saved value as `effectiveValue`; older
frontend-only assumptions such as `defaultValue` or `explicitValue` are not required for
the edit flow. Save and Reset therefore show the actual accepted or reverted/default
`effectiveValue` without requiring a page reload.

## Reset confirmation and live-plan impact

Reset (`DELETE /v1/plans/{planId}/limits/{dimensionKey}`) removes the explicit value for a
dimension and reverts the row to the backend-resolved default/effective value. It is
always routed through the shared destructive confirmation dialog before the DELETE is
sent.

When the plan is active, the Limits tab shows a live-plan indicator with the active
assignment count from the plan detail record. The Reset confirmation repeats that impact
copy, for example "Afecta a 2 organizaciones activas asignadas a este plan", so the
operator sees that a shared active plan change can alter current tenant entitlements.
Draft plans use draft-specific copy; deprecated and archived plans render the limits as
read-only.

## Contract note

This behavior does not change the public API contract. It aligns the web console with the
existing plan-limit write/read responses and requires no OpenAPI, route catalog, generated
SDK, or shared-contract regeneration.

## Other consumers of this write path

The Quotas page (`/console/quotas`) also edits a plan limit through this same
`setPlanLimit` write path — its "Ajustar cuota" action resolves the active tenant's
current plan and edits that plan's limit for the clicked dimension, honestly disclosing
that the change affects every tenant on that plan. See
[console-quotas-adjustment.md](./console-quotas-adjustment.md) for that flow, including
its no-plan and frozen-plan (`PLAN_LIMITS_FROZEN`) actionable states.
