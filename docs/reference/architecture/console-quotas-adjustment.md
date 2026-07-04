# Console quota-adjustment action (`/console/quotas`)

The Quotas page (`apps/web-console/src/pages/ConsoleQuotasPage.tsx`) shows each quota
dimension's hard limit, measured usage, and posture for the active tenant and (when one
is selected) its active workspace. For superadmins, every dimension row has an "Ajustar
cuota" action. This page documents what that action actually edits, and why (issue #750
— the action used to render with no `onClick` at all).

## What "Ajustar cuota" edits

`/console/quotas` does not have its own quota-override write endpoint. There is no
per-tenant/per-dimension quota-override route in the public route catalog
(`services/internal-contracts/src/public-route-catalog.json`): the only quota-policy
`POST` is scoped to a *plan* (`createQuotaPolicy`,
`/v1/platform/plans/{planId}/quota-policies`) with no update route, and the real
per-workspace override action (`workspace-sub-quota-set.mjs`, routed as `POST
/v1/workspace-sub-quotas`) is wired only in the kind-deploy route table, not in the
public route catalog the console/OpenAPI contract is generated from.

The dimension values the page renders are, in the real deployed control plane,
synthesized directly from the tenant's **plan limits**: `dimensionsFromLimits()`
(`deploy/kind/control-plane/metrics-handlers.mjs`) maps `dimensionId: dimensionKey` and
`hardLimit: effectiveValue` straight off the tenant's effective entitlements (see
[console-effective-entitlements-mapping.md](./console-effective-entitlements-mapping.md)),
whose `effectiveValue` resolves from the tenant's assigned plan's
`quotaDimensions[dimensionKey]`. So the dimension keys shown here (`max_workspaces`,
`flow_signal_rate_per_minute`, …) are exactly the plan-limit `dimensionKey`s already
served by `PUT /v1/plans/{planId}/limits/{dimensionKey}`
(`planManagementApi.setPlanLimit`) — the same write path the plan detail page's Limits
tab uses (see
[console-plan-limit-edit-feedback.md](./console-plan-limit-edit-feedback.md)).

"Ajustar cuota" therefore opens `QuotaAdjustDialog`
(`apps/web-console/src/components/console/QuotaAdjustDialog.tsx`), which:

1. Resolves the active tenant's current plan (`planManagementApi.getTenantCurrentPlan`).
2. Lets the operator enter a new value for that dimension (`-1` = sin límite) and calls
   `planManagementApi.setPlanLimit(planId, dimensionKey, value)` on submit.
3. On success, shows an in-dialog confirmation and calls the page's `reload()` so the
   quotas table (both the "Organización" and "Área de trabajo" sections) reflects the
   new value once the dialog closes, without a manual page refresh.
4. On failure (e.g. `INVALID_LIMIT_VALUE`, `PLAN_LIMITS_FROZEN`), shows an inline error
   and keeps the dialog open with the operator's entered value intact — nothing is
   applied to the table until the API accepts it, so there is nothing to roll back.

Both the "Organización" and "Área de trabajo" tables' "Ajustar cuota" buttons open the
same dialog, scoped to the active tenant's plan — editing from either table edits the
same tenant-wide plan limit (a workspace does not have its own quota-override write
path wired to the console).

## Shared-plan caveat

Because the write target is the tenant's *assigned plan*, not a tenant- or
workspace-specific override, the dialog explicitly discloses: saving a new limit here
changes that plan's limit for **every** tenant currently assigned to it, not just the
active one. This is stated in the dialog body before the operator submits.

## No-plan and frozen-plan states

Editing a plan limit requires an actual plan to edit. `QuotaAdjustDialog` never dead-ends
silently:

- If the active tenant has no plan assigned (`getTenantCurrentPlan` returns
  `{ noAssignment: true }`), the dialog explains that there is no plan limit to adjust
  here and offers a CTA link to `/console/tenants/{tenantId}/plan` to assign one — the
  same per-tenant plan destination the `/console/tenants` inventory rows link to (see
  [console-tenant-inventory.md](./console-tenant-inventory.md)).
- If the assigned plan's status is `archived` or `deprecated` (limits are frozen — see
  `PLAN_LIMITS_FROZEN` in
  [console-plan-limit-edit-feedback.md](./console-plan-limit-edit-feedback.md)), the
  dialog explains that the plan no longer accepts limit changes and offers a CTA link
  to that plan's detail page so an operator can change its lifecycle state or reassign
  a different plan.

## Contract note

This does not change the public API contract. It consumes the already-public,
already-generated `planManagementApi` endpoints (`GET /v1/tenants/{tenantId}/plan`,
`PUT /v1/plans/{planId}/limits/{dimensionKey}`) exactly as the plan detail page already
does. `npm run generate:public-api` and `npm run validate:public-api` produce no diff.
