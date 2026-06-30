# Console plan-limit edit feedback and reconciliation

The superadmin plan detail page (`/console/plans/{planId}`) lets platform operators edit
plan quota dimensions from the **Limits** tab. That editor must treat the control-plane
API as the source of truth: a typed value is only a saved limit after the API accepts it.

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

## Failure flow

Rejected values such as `1.5` or `-5` return `INVALID_LIMIT_VALUE` and are not persisted.
The console awaits the write, shows an explicit error on the Limits tab, and refreshes (or
re-emits) the last profile so the editable input returns to the last persisted
`effectiveValue`. It must not set `source: explicit` or display the rejected number as a
saved limit.

Other write failures follow the same rule: surface the error, do not run success feedback,
and do not display a failed value as saved. For frozen plans, `PLAN_LIMITS_FROZEN` is shown
as a plan state problem rather than silently changing the row.

## Table input rule

`PlanLimitsTable` keeps a local draft string while the operator is typing, but the visible
input is reset whenever the parent passes a refreshed `dimensions` profile. This matters
because the authoritative profile rows expose the saved value as `effectiveValue`; older
frontend-only assumptions such as `defaultValue` or `explicitValue` are not required for
the edit flow. Reset therefore shows the actual reverted/default `effectiveValue` without
requiring a page reload.

## Contract note

This behavior does not change the public API contract. It aligns the web console with the
existing plan-limit write/read responses and requires no OpenAPI, route catalog, generated
SDK, or shared-contract regeneration.
