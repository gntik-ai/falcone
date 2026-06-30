# Tasks: fix-784-function-list-tenant-scope

## 1. Reproduce (test-first)
- [x] Add `tests/unit/function-list-tenant-scope.test.mjs` (CI-run) encoding the issue scenarios
      (cross-tenant LIST → 403 with no leak; own-tenant LIST → 200; superadmin bypass → 200;
      store-level tenant predicate). RED on current code.

## 2. Fix the store (defense-in-depth)
- [x] `tenant-store.mjs::listFnActions` — add optional `tenantId` arg; when set, filter
      `AND tenant_id=$2` (mirrors `getFnAction`); unscoped when omitted.

## 3. Fix the handlers (the gate)
- [x] `fn-handlers.mjs::fnInventory` — resolve via `ownedWorkspace`; `403` for foreign/unknown;
      pass `callerTenantId(ctx.identity)` to `listFnActions`.
- [x] `fn-handlers.mjs::fnListActions` — same gate and scoped list.

## 4. Contract / frontend / docs
- [x] Confirm the OpenAPI `inventory` and `actions` paths already document `403` — no contract
      edit (`generate:public-api` stays a no-op).
- [x] Confirm the web console only lists its own workspace — no frontend change.
- [x] No human-doc change needed (the OpenAPI is the wire doc and already documents `403`).

## 5. Verify
- [x] `tests/unit/function-list-tenant-scope.test.mjs` GREEN after the fix (6 cases; reproduces the
      leak RED-before/GREEN-after; reviewer to re-run `pnpm test:unit`).
- [x] `openspec validate fix-784-function-list-tenant-scope --strict` (reviewer to confirm in an
      environment with the `openspec` CLI on PATH).
