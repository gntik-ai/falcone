## Why

The superadmin per-tenant plan page crashes on every visit. The route
`tenants/:tenantId/plan` (`apps/web-console/src/router.tsx:191-192`, gated by
`RequireSuperadminRoute`) mounts `ConsoleTenantPlanPage`, which renders:

```jsx
rows={summary.quotaDimensions.map((item) => ({ … currentUsage: item.observedUsage ?? null, … }))}
```

(`apps/web-console/src/pages/ConsoleTenantPlanPage.tsx:31`) — unguarded, after the
loading guard at line 23.

But the effective-entitlements API does NOT return `quotaDimensions`. The authoritative
backend model `EffectiveEntitlementProfile`
(`services/provisioning-orchestrator/src/models/effective-entitlements.mjs:19-23`) returns
`{ tenantId, planSlug, planStatus, quantitativeLimits: QuantitativeLimitEntry[], capabilities }`,
where each `QuantitativeLimitEntry`
(`…/effective-entitlements.mjs:1-5`) carries `currentUsage` (NOT `observedUsage`). The
kind control-plane serves this verbatim — `deploy/kind/control-plane/b-handlers.mjs`
spreads `...profile` with no field rename. The page calls
`getEffectiveEntitlements(tenantId, { includeConsumption: true })`
(`ConsoleTenantPlanPage.tsx:19`), i.e. the `include=consumption` path.

So `summary.quotaDimensions` is `undefined` → `.map` throws
`TypeError: Cannot read properties of undefined (reading 'map')`. Since #755 added a
router-level `RouteErrorBoundary`, the crash now renders a friendly in-shell error
instead of a blank screen, but the plan content (quota limits + assign/change-plan
control) still never renders — the acceptance criterion is still violated. Confirmed on
HEAD `6e0f71ad`.

Root cause: the frontend reads the wrong field name. The backend contract is correct and
must not change; the frontend must conform to it.

## What Changes

- **`apps/web-console/src/pages/ConsoleTenantPlanPage.tsx`** — read the real backend
  field: `summary.quotaDimensions.map(...)` → `(summary.quantitativeLimits ?? []).map(...)`
  (guarded so it never throws even if the field is absent), and within the row mapping
  `currentUsage: item.observedUsage ?? null` → `currentUsage: item.currentUsage ?? null`
  so the consumption column populates from the real field. No other restructuring;
  `source: 'plan'` is left as-is (re-attribution is out of scope).
- **`apps/web-console/src/services/planManagementApi.ts`** — add a correctly-typed
  optional `quantitativeLimits?` field to `CurrentEffectiveEntitlementSummary` mirroring
  the backend `QuantitativeLimitEntry` (with `currentUsage`). The legacy/incorrect
  `quotaDimensions` field is kept unchanged (with a clarifying comment): it is still read
  by `ConsoleTenantPlanOverviewPage.tsx`, whose fix is tracked separately under issue #735;
  removing it would break that file's compile and overstep this change's scope.
- **`apps/web-console/src/pages/ConsoleTenantPlanPage.test.tsx`** — the existing mock
  fabricated the buggy shape (`quotaDimensions: []`), so it passed on broken code. The
  mock is changed to resolve the REAL API shape (`quantitativeLimits` with one populated
  entry, no `quotaDimensions`), and an assertion is added that the limit row renders from
  `quantitativeLimits`. This is RED on main (component reads undefined `quotaDimensions`
  → `.map` throws → render fails → test errors) and GREEN on the branch.
- **No contract artifacts changed**: this conforms the frontend to the EXISTING backend
  contract. No `*.openapi.json`, no generated SDK/types, no `internal-contracts`, no
  gateway/route-catalog, no OpenAPI diff — re-running codegen yields no diff.
- **Docs**: add a short reference doc documenting that the console reads per-tenant
  effective quota limits from the API's `quantitativeLimits` field (with per-item
  `currentUsage`) on the superadmin `/console/tenants/{tenantId}/plan` page, and guards
  absent fields.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — the superadmin per-tenant plan page must read
  effective quota limits from the effective-entitlements API's `quantitativeLimits` field
  (per-item `currentUsage`), guard the field when absent, and render without an unhandled
  exception. This is a new requirement under `web-console` (no existing requirement in
  `openspec/specs/web-console/spec.md` covers the superadmin per-tenant plan page reading
  effective quota limits), so it is added as `## ADDED Requirements` rather than MODIFIED.
