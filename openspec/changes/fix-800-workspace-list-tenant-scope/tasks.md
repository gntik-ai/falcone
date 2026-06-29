# Tasks: fix-800-workspace-list-tenant-scope

## 1. Reproduce (test-first)
- [x] Add `tests/unit/workspace-list-tenant-scope.test.mjs` (CI-run) encoding the issue
      scenarios: null-tenant principal → empty (RED on unfixed code); own-tenant → scoped;
      superadmin → all; list↔by-id agreement; store-level null-tenantId guard.

## 2. Fix the store (defense-in-depth)
- [x] `tenant-store.mjs::listWorkspaces` — add `allTenants = false` param; early-return
      `{items:[],total:0}` when `!tenantId && !allTenants`; the WHERE predicate is only
      dropped when `allTenants` is explicitly `true` (superadmin/internal intent).

## 3. Fix the handler (the gate)
- [x] `b-handlers.mjs::listWorkspaces` — compute `isPlatform`; for a non-platform principal
      with no `tenantId` return `ok(200, collection([], 0))` immediately (fail-closed);
      pass `allTenants: isPlatform && !tenantId` to the store so the superadmin "list all"
      path is explicit.

## 4. Verify unaffected callers
- [x] Confirm `listTenantWorkspaces` (≈427) passes a truthy `tenant.id` — unaffected.
- [x] Confirm `exportTenantConfiguration` (≈525) passes a truthy `tenant.id` — unaffected.

## 5. Contract / frontend / docs
- [x] Confirm `GET /v1/workspaces` response shape is unchanged (empty collection is valid) —
      no OpenAPI edit, no codegen diff.
- [x] Confirm the web console renders the returned collection; a tenant-less user now sees
      empty — no frontend change.

## 6. Verify
- [x] `tests/unit/workspace-list-tenant-scope.test.mjs` GREEN after the fix (8 cases;
      reproduces the leak RED-before/GREEN-after; reviewer to re-run `pnpm test:unit`).
- [x] `openspec validate fix-800-workspace-list-tenant-scope --strict` passes.
