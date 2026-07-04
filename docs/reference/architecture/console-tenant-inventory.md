# Console tenant inventory (`/console/tenants`)

Before this change, `/console/tenants` (`apps/web-console/src/pages/ConsoleTenantsPage.tsx`)
rendered only a header and a static "Inventario" card ("Desde esta superficie se inicia el
alta guiada de nuevas organizaciones."). There was no list of tenants and no way to reach a
specific tenant's plan/quotas/IAM surfaces without already knowing (and typing) its UUID in
the URL — the platform's primary object had no inventory in the console (issue #752).

## What the page does now

`ConsoleTenantsPage` renders a real table (organization, slug, lifecycle state, action) for
platform users, sourced from `useConsoleContext()`'s `tenants` collection — the same data the
shell header's tenant selector already fetches via `GET /v1/tenants`
(`apps/web-console/src/lib/console-context.tsx`). No duplicate fetch was introduced: the page
reuses the context's tenant list and its `reloadTenants()`/`tenantsLoading`/`tenantsError`
state, so it stays in sync with the rest of the shell and follows the console's established
loading/error/empty idioms (`ConsolePageState`, matching `ConsoleQuotasPage`).

Each row's action is role-forked, because `/console/tenants/{tenantId}/plan` is itself
superadmin-gated (`RequireSuperadminRoute` in `router.tsx`): a `superadmin` gets an "Abrir plan"
`<Link>` to that route (keyboard accessible, no synthetic click handlers) that also calls
`selectTenant(tenantId)` so the tenant becomes the shell's active context — no need to type a
tenant UUID into the URL bar. `platform_admin` / `platform_operator` — who can see the inventory
but would be bounced off the plan route — instead get a "Usar como activa" `<Button>` that only
calls `selectTenant(tenantId)`, with no plan link, so the row never offers a destination it can't
actually reach.

### Pagination honesty

`GET /v1/tenants` is called with `page[size]=100`. If the response's `page.after` cursor is
non-null (more tenants exist beyond the first page), the table shows an explicit "Mostrando
las primeras N organizaciones. Hay más organizaciones disponibles no incluidas en esta vista."
notice instead of silently truncating the inventory.

### Role-awareness

The `/console/tenants` route itself is not superadmin-gated (tenant operators can still land
on it), but `GET /v1/tenants` (the collection endpoint) 403s for tenant operators — only
`superadmin` / `platform_admin` / `platform_operator` can list it (see the identical
`isTenantOperator` predicate in `console-context.tsx`, #569). Rather than surface a broken
table or an empty-looking list, the page checks the caller's platform roles and shows an
honest `ConsolePageState kind="blocked"` explaining that the inventory is a platform-level
view, with a CTA to `/console/my-plan` (the tenant-scoped equivalent) instead.

Within the platform tier, role-awareness goes one level deeper than "can view the inventory or
not" (`ConsoleTenantsPage.tsx`'s `canOpenTenantPlan` check, gated on the same predicate as
`RequireSuperadminRoute`):

- `superadmin` — sees the inventory and gets the "Abrir plan" link on every row.
- `platform_admin` / `platform_operator` — see the same inventory, but each row instead offers
  "Usar como activa" only, because the per-tenant plan route is superadmin-only and a link to it
  would silently bounce them back to `/console/my-plan`.
- Tenant operators (`tenant_owner`, `tenant_admin`, …) — never reach the table at all; they get
  the "Inventario no disponible para tu rol" blocked state described above.

## Wizard success is navigable

The create-tenant wizard's success step (`WizardSummaryStep`) used to link back to the
generic, then-static `/console/tenants` list. It now renders an "Abrir recurso" link — a link
on the success step, not an automatic redirect — whose destination is role-aware, for the same
reason the row action above is: `/console/tenants/{tenantId}/plan` is superadmin-gated.
`CreateTenantWizard.tsx`'s `onSubmit` return value sends a `superadmin` straight to
`/console/tenants/{tenantId}/plan` for the tenant that was just created; any other role allowed
to create a tenant (e.g. `platform_operator`) is sent to `/console/tenants` instead, where the
new tenant now appears because `onSubmit` also calls `onCreated` (wired by `ConsoleTenantsPage`
to `reloadTenants()`) — so the inventory reflects the new tenant without a manual refresh,
whichever destination the operator's role resolves to.

## Context status cards on platform-global pages

`ConsoleShellLayout` renders two "Organización activa" / "Área de trabajo activa" status
cards above every console page's content. On platform-global surfaces — routes that are not
scoped to an active tenant/workspace, such as the plan catalog under `/console/plans*` —
those cards implied a context dependency that does not exist. Routes now opt into hiding them
via route `handle: { platformGlobal: true }` metadata in `router.tsx`, read by
`ConsoleShellLayout` through `useMatches()`, instead of a pathname string check. Tenant-scoped
routes (e.g. `/console/overview`, `/console/tenants/{tenantId}/plan`) are unaffected and keep
showing the cards.

## Contract note

This is a frontend-only change: it consumes the already-public, already-generated
`GET /v1/tenants` collection endpoint exactly as the shell's tenant selector already does.
`npm run generate:public-api` and `npm run validate:public-api` produce no diff.
