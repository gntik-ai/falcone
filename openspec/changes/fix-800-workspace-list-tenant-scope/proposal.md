# Change: fix-800-workspace-list-tenant-scope

## Why

Issue #800 is a CONFIRMED high-severity tenant-isolation fail-open in the control-plane
workspace surface (capability: tenant-isolation; personas P4 application developer,
P7 platform operator, P19 security reviewer).

`GET /v1/workspaces` is the only workspace read path that fails open. The handler
(`deploy/kind/control-plane/b-handlers.mjs::listWorkspaces`) computes
`tenantId = identity.tenantId` for any non-superadmin/non-internal principal, but applies
**no guard** when that value is `null` — for example a platform-realm `tenant_viewer` whose
JWT carries no `tenant_id` claim. The computed `null` is passed straight to the store.

The store (`deploy/kind/control-plane/tenant-store.mjs::listWorkspaces`) uses
`tenantId ? 'WHERE tenant_id = $3' : ''` — a truthy guard that **silently drops** the
predicate for a falsy `tenantId`, issuing an unscoped `SELECT … FROM workspaces` that
returns every tenant's rows. The serialized rows include `id`, `tenant_id`, `slug`,
`display_name`, `environment`, and `created_by` for every workspace in the system.

By contrast, every by-id path already 403s such a principal: `getWorkspace` (≈435,
`canManageTenantId`), `listTenantWorkspaces` (≈426), `getTenant` (≈207), and
`GET /v1/tenants` (superadmin-only route). The LIST is the sole fail-open path, and by-id
and LIST were in contradiction: the same principal that is 403'd reading a workspace by id
could enumerate every workspace in the system through the LIST.

## What Changes

- **Layer 1 — handler `b-handlers.mjs::listWorkspaces`**: Introduce an `isPlatform` boolean
  (`actorType === 'superadmin' || actorType === 'internal'`). For a non-platform principal
  with no resolvable `tenantId`, return `200 {items:[],total:0}` immediately (fail-closed),
  matching what by-id reads already return for such a principal. Pass `allTenants: true` to
  the store only for a platform principal with no `filter[tenantId]` (the superadmin
  "list all" path), so the intent is explicit.

- **Layer 2 — store `tenant-store.mjs::listWorkspaces`**: Add an `allTenants = false`
  parameter and an early-return guard: when `!tenantId && !allTenants` return
  `{items:[], total:0}` without issuing any SQL. This removes the footgun — a missing
  `allTenants` intent can never silently drop the WHERE predicate, providing defense-in-depth
  for every current and future caller.

- The three other callers of `store.listWorkspaces` in the same file
  (`listTenantWorkspaces` at ≈427 and the export-config assembler at ≈520) both pass a
  truthy `tenant.id`; neither `allTenants` is needed nor touched.

- **Tests**: a new `tests/unit/workspace-list-tenant-scope.test.mjs` (run in CI via
  `pnpm test:unit`) covers all three acceptance scenarios from the issue plus store-level
  defense-in-depth. Tests are RED on the unfixed code, GREEN after.

- **No public contract change**: `GET /v1/workspaces` still returns a collection; an empty
  `{items:[],total:0,page:{…}}` is a valid response that already describes the case when the
  caller has no workspaces. No OpenAPI edit, no generated-client regeneration.

- **Frontend**: the web console already renders the returned collection; a tenant-less user
  now correctly sees an empty list. No web-console code change.

## Impact

- Affected code:
  - `deploy/kind/control-plane/b-handlers.mjs` (`listWorkspaces`).
  - `deploy/kind/control-plane/tenant-store.mjs` (`listWorkspaces`).
- Affected capability: `tenant-isolation` (ADDED requirement "Workspace listing is
  tenant-scoped and fail-closed").
- Tests: new `tests/unit/workspace-list-tenant-scope.test.mjs` (CI runs `pnpm test:unit`).
- Frontend: **no change** — the web console only ever lists the user's own workspaces.
- Contract / SDK: **no change** — the `GET /v1/workspaces` response shape is unchanged;
  empty collection is already a valid response.
- Backward-compatible: the new `allTenants` store argument is opt-in (default false);
  all existing callers that supply a truthy `tenantId` are unaffected.
