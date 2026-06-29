# Change: fix-784-function-list-tenant-scope

## Why

Issue #784 is a CONFIRMED Critical cross-tenant IDOR in the control-plane functions surface
(capability: functions / tenant-isolation; personas P4 application developer, P7 platform
operator, P19 security reviewer). The two workspace-scoped function **LIST** endpoints —
`GET /v1/functions/workspaces/{workspaceId}/inventory` and
`GET /v1/functions/workspaces/{workspaceId}/actions` — omit tenant scoping entirely. Their
handlers (`deploy/kind/control-plane/fn-handlers.mjs::fnInventory` and `::fnListActions`)
call `store.listFnActions(pool, ctx.params.workspaceId)` with **no caller tenant** and
**never resolve or own-check the workspace**, while the underlying store query
(`tenant-store.mjs::listFnActions`) is `SELECT * FROM fn_actions WHERE workspace_id=$1`
with **no tenant predicate**. The serialized rows include `tenantId` and, critically,
`source.inlineCode` (the function's source). As a result, any authenticated tenant can pass
another tenant's `workspaceId` and read that tenant's function metadata and source code —
a cross-tenant data leak.

This is the cardinal multitenant bug: a missing `tenant_id` scope on a read path. The
by-id siblings in the same module (`fnActionDetail`/`fnInvoke`) already pass
`callerTenantId(ctx.identity)` to `getFnAction` (which filters `AND tenant_id=$2`), and the
export handler `fnPackageDefinitionExport` already resolves the workspace through the
existing `ownedWorkspace(ctx, workspaceId)` gate. The two LIST handlers are the only function
reads that skip the gate.

## What Changes

- Gate both LIST handlers (`fnInventory`, `fnListActions`) through the existing
  `ownedWorkspace(ctx, workspaceId)` helper: it resolves the workspace and returns it only
  when the caller's verified tenant owns it. For a superadmin/internal caller `callerTenantId`
  is `null`, so the ownership check is skipped and the workspace IS returned (the cross-tenant
  administrative read is preserved). A foreign or unknown workspace now yields `403 FORBIDDEN`
  ("authenticated but not authorized for this scope") — the response already documented for
  these routes — with no foreign data and no existence oracle.
- Add an optional tenant predicate to `tenant-store.mjs::listFnActions(pool, workspaceId,
  tenantId = null)` (defense-in-depth, mirroring `getFnAction`): when a `tenantId` is
  supplied the query filters `AND tenant_id=$2`; when omitted (superadmin/internal) it stays
  unscoped, preserving the cross-tenant view. The handlers pass
  `callerTenantId(ctx.identity)`.
- Superadmin/internal cross-tenant read is preserved.
- No public contract change: the `inventory` and `actions` paths already document a `403`
  response, so the runtime now agrees with the published contract (`generate:public-api`
  stays a no-op).
- Add a new regression test (CI-run, in `tests/unit/`) that reproduces the leak (RED before,
  GREEN after) and asserts no foreign source/tenant id is returned.

## Impact

- Affected code:
  - `deploy/kind/control-plane/fn-handlers.mjs` (`fnInventory`, `fnListActions`).
  - `deploy/kind/control-plane/tenant-store.mjs` (`listFnActions`).
- Affected capability: `functions` (MODIFIED requirement "Function access MUST be scoped to the
  caller's tenant" — strengthened to also enforce tenant ownership on the workspace-scoped
  inventory/actions LIST routes).
- Tests: new `tests/unit/function-list-tenant-scope.test.mjs` (CI runs `pnpm test:unit`).
- Frontend: **no change** — the web console (`apps/web-console/src/services/functionsApi.ts`)
  only ever calls the actions LIST endpoint for the user's own active workspace, so legitimate
  behavior is unchanged.
- Contract / SDK: **no change** — the `403` response is already declared for both paths.
- Backward-compatible: the new `listFnActions` `tenantId` argument is optional; all existing
  callers (`resolvedRefCount`, `fnPackageDefinitionExport`) keep their current behavior.
