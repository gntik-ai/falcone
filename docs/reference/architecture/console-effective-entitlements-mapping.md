# Console — effective-entitlements field mapping

The web console renders a tenant's effective quota limits and capabilities from the
**effective-entitlements** API. This page documents the wire shape that API returns and the
field the console must read, so the two stay in sync.

## The wire shape

The effective-entitlements endpoint
(`GET /v1/tenants/{tenantId}/plan/effective-entitlements` for superadmins, or
`GET /v1/tenant/plan/effective-entitlements` for a tenant operator's own tenant) returns the
`EffectiveEntitlementProfile` model
(`services/provisioning-orchestrator/src/models/effective-entitlements.mjs`):

```text
EffectiveEntitlementProfile {
  tenantId
  planSlug
  planStatus
  quantitativeLimits: QuantitativeLimitEntry[]   // the quota limits
  capabilities:        CapabilityEntry[]
}

QuantitativeLimitEntry {
  dimensionKey
  displayLabel
  unit
  effectiveValue
  source            // 'override' | 'plan' | 'catalog_default'
  quotaType         // 'hard' | 'soft'
  graceMargin
  currentUsage      // populated when the request includes consumption
  usageStatus       // 'within_limit' | 'approaching_limit' | … | 'unknown'
  usageUnknownReason
}
```

The kind control-plane serves this verbatim — `deploy/kind/control-plane/b-handlers.mjs`
routes the request to `tenant-effective-entitlements-get.mjs`, which spreads `...profile`
with no field renaming. The console requests the consumption-enriched form via
`getEffectiveEntitlements(tenantId, { includeConsumption: true })`
(`apps/web-console/src/services/planManagementApi.ts`), which appends `?include=consumption`
so `currentUsage` / `usageStatus` are populated.

## The field the console reads

The per-tenant quota limits live under **`quantitativeLimits`**, and per-item usage lives
under **`currentUsage`**. There is **no** `quotaDimensions` field and **no** `observedUsage`
field on this response.

The superadmin per-tenant plan page
(`apps/web-console/src/pages/ConsoleTenantPlanPage.tsx`, route
`/console/tenants/{tenantId}/plan`, gated by `RequireSuperadminRoute`) maps
`quantitativeLimits` into the `QuotaConsumptionTable`, using each entry's `currentUsage` for
the consumption column. It reads the field defensively:

```jsx
rows={(summary.quantitativeLimits ?? []).map((item) => ({
  …,
  currentUsage: item.currentUsage ?? null,
  …,
}))}
```

The `?? []` guard means an absent or empty `quantitativeLimits` renders an empty limits
table rather than throwing — the page renders the assign/change-plan control either way and
never crashes into the router error boundary.

The tenant "My Plan" page
(`apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx`, route `/console/my-plan` —
the default landing page for non-superadmin console principals) reads the same
`quantitativeLimits` collection from the tenant-scoped
`GET /v1/tenant/plan/effective-entitlements` call, with the same defensive guard:

```jsx
const limits = summary.quantitativeLimits ?? []
```

An empty or absent `quantitativeLimits` renders a `ConsolePageState kind="empty"` "Sin
cuotas" message instead of the `QuotaConsumptionTable`, so the page never throws on a
tenant with no populated quota dimensions. The page's header shows the real `planSlug`
field only — it previously also displayed fictitious `planDisplayName` /
`latestHistoryEntryId` fields and gated on a `noAssignment` field, none of which this
endpoint (or the `EffectiveEntitlementProfile` model backing it) ever returns; those were
removed as part of fixing this page (issue #735).

> Note: the shared TypeScript type `CurrentEffectiveEntitlementSummary`
> (`apps/web-console/src/services/planManagementApi.ts`) still declares a legacy
> `quotaDimensions` field alongside the correct `quantitativeLimits`. That legacy field does
> not correspond to anything the API returns. As of issue #735, no page reads it anymore —
> it is retained only because `PlanQuotaImpactTable.tsx` structurally types its `items`
> prop against this shape (that component is, in practice, only ever invoked with the
> unrelated, real `PlanQuotaImpact[]` history-impact shape, never with `quotaDimensions`
> data). Removing the field entirely requires also updating that component's type union.

## Platform admins and My Plan

`/console/my-plan` is an own-tenant page. A tenant-less platform principal (`superadmin`,
`platform_admin`, or `platform_operator` with no `tenantIds` in the console session) has no personal
tenant plan, so the page must not call `GET /v1/tenant/plan/effective-entitlements`. It renders the
empty state "Sin plan personal de organización" instead of surfacing the backend
`TENANT_NOT_FOUND` code. The tenant-specific plan page
`/console/tenants/{tenantId}/plan` uses the tenant-id route above and is guarded by the console's
superadmin route gate; non-superadmin platform roles do not get a link to that page from My Plan.

## Sidebar navigation (issue #741)

`/console/my-plan` and `/console/my-plan/allocation` (`ConsoleTenantAllocationSummaryPage.tsx`,
which reads the per-workspace breakdown of the same `EffectiveEntitlementProfile` limits via
`GET /v1/tenant/plan/allocation-summary`) each have a sidebar entry — **Mi plan** and **Resumen
de asignación** — in `ConsoleShellLayout.tsx`'s `main` navigation group. Neither entry carries a
role gate: both routes have no route guard, and both pages already degrade honestly for a
tenant-less platform principal (the "Platform admins and My Plan" section above, and the
equivalent "Sin plan de organización personal" empty state in
`ConsoleTenantAllocationSummaryPage.tsx`), so showing the entries to every signed-in role —
platform or tenant-scoped — never produces a new dead end.

Because `/console/my-plan/allocation` is a child path of `/console/my-plan`, the **Mi plan**
entry matches its route exactly (`exactActive`, i.e. the `NavLink` `end` prop). Without it the
parent entry would also match the child route and both entries would carry `aria-current="page"`
at once; with it, exactly one of the two entries is the current page on each route — the same
convention the `Funciones: administrar` entry uses for its own `…/data` child (#797).

The full sidebar role matrix, after #741:

| Entry | superadmin | platform_admin / platform_operator | tenant_owner / other tenant roles |
| --- | --- | --- | --- |
| Mi plan (`/console/my-plan`) | shown | shown | shown |
| Resumen de asignación (`/console/my-plan/allocation`) | shown | shown | shown |
| Gestión de organizaciones (`/console/tenants`) | shown | shown (real inventory) | **hidden** |
| Acceso IAM (`/console/iam-access`) | shown | **hidden** | **hidden** |
| Planes (`/console/plans`) | shown | **hidden** | **hidden** |
| Autenticación (`/console/auth`) | shown | **hidden** | **hidden** |

`Gestión de organizaciones` is gated on the shared `hasPlatformInventoryAccess` predicate
(`apps/web-console/src/lib/console-principal.ts`) — the same predicate that decides whether
`ConsoleTenantsPage.tsx` renders a real cross-tenant inventory or an honest blocked state (see
`docs/reference/architecture/console-tenant-inventory.md`). `Acceso IAM`, `Planes`, and
`Autenticación` are gated on `requiresSuperadminAccess`, matching their `RequireSuperadminRoute`
route guard in `router.tsx` exactly, so the sidebar never offers a link that silently redirects
the operator elsewhere.

> Issue #761 adds a second, additive nav treatment on top of the visibility gating above: for a
> read-only tenant role (`tenant_viewer`/`tenant_developer`), a further set of write-only entries
> (`Gestión de áreas de trabajo`, `DB del área de trabajo`, the `Funciones: *` family, `Cuentas de
> servicio`, `Secretos del área de trabajo`) is *regrouped* — not hidden — under an "Administración
> (requiere permisos)" heading, and the post-login/`/console` index landing destination changes to
> `/console/observability`. See
> `docs/reference/architecture/console-permission-aware-tenant-roles.md`.
