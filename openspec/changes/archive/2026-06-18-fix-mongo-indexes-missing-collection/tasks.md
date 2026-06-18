# Tasks — fix-mongo-indexes-missing-collection

## Reproduce (test-first)
- [x] Failing black-box probe: `tests/blackbox/mongo-indexes-missing-collection.test.mjs` — indexes on a missing collection threw FerretDB code 26 (NamespaceNotFound) from `.indexes()` (unscoped caller) / `tenantCollectionCount` (tenant caller) → 500.

## Implement (kind runtime AND shippable product)
- [x] `mongoIndexes` now probes existence with `listCollections({name})` up front and returns 404 COLLECTION_NOT_FOUND for a missing collection (mirrors `mongoCollectionDetail`) — `deploy/kind/control-plane/mongo-handlers.mjs`.
- [x] Kind-only: the collection-indexes browse route is served by the kind control-plane; the executor data-plane (`apps/control-plane`) exposes no index-listing route, so no product-side change is needed.

## Verify
- [x] Black-box suite green: bbx-mongo-index-01 (tenant caller → 404), -02 (superadmin/unscoped → 404), -03 (existing collection → 200 with index items); mongo-browse-tenant-scope regression unchanged.
- [x] Acceptance: 404 not 500; no Mongo code 26 leak.

## Archive
- [x] `openspec validate fix-mongo-indexes-missing-collection --strict`; archived with the P2 batch.
