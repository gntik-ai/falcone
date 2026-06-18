# Tasks — fix-mongo-browse-tenant-scope

## Reproduce (test-first)
- [x] Add a failing black-box probe: `tests/blackbox/mongo-browse-tenant-scope.test.mjs` (tenant B reads tenant A's documents in a shared collection; cross-tenant browse enumerates names/counts).

## Implement (kind runtime AND shippable product)
- [x] Scope the control-plane mongo handlers by the caller's tenant in `deploy/kind/control-plane/mongo-handlers.mjs`. FerretDB is one shared cluster keyed only by a `tenantId` field (db/collection names are shared), so: `mongoDocuments` enforces workspace ownership (404 cross-tenant) + filters `find({ tenantId })` (matching the executor's `applyTenantScopeToFilter`); browse handlers (`mongoListDatabases/Collections/CollectionDetail/Indexes/Views`) report tenant-scoped counts and hide names the caller's tenant has no data in. Superadmin/internal unscoped.
- [x] The product data-plane (executor `services/adapters` mongodb-data-api) already scopes by `tenantId`; the kind control-plane browse glue was the unscoped site, so the fix is confined there. Added a `ctx.mongoClient` test injection point.

## Verify
- [x] Black-box suite green (718 pass); new test `mongo-browse-tenant-scope` 6/6.
- [x] Acceptance: Cross-tenant document read → 404; cross-tenant browse/list → empty; own data intact; superadmin unscoped.

## Archive
- [ ] `openspec validate fix-mongo-browse-tenant-scope --strict` (passing); `/opsx:archive fix-mongo-browse-tenant-scope` after merge.
