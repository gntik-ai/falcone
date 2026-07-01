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

> Note: the shared TypeScript type `CurrentEffectiveEntitlementSummary`
> (`apps/web-console/src/services/planManagementApi.ts`) still declares a legacy
> `quotaDimensions` field alongside the correct `quantitativeLimits`. That legacy field does
> not correspond to anything the API returns; it is retained only because
> `ConsoleTenantPlanOverviewPage.tsx` still reads it. Aligning that page to
> `quantitativeLimits` (and removing the legacy field) is tracked separately under issue #735.

## Platform admins and My Plan

`/console/my-plan` is an own-tenant page. A tenant-less platform principal (`superadmin`,
`platform_admin`, or `platform_operator` with no `tenantIds` in the console session) has no personal
tenant plan, so the page must not call `GET /v1/tenant/plan/effective-entitlements`. It renders the
empty state `No personal tenant plan` instead of surfacing the backend
`TENANT_NOT_FOUND` code. Platform operators manage a tenant's entitlements from
`/console/tenants/{tenantId}/plan`, which uses the tenant-id route above.
