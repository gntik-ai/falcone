## 1. Failing tests proving the gap

- [ ] 1.1 [test] Add `tests/unit/mongo-data-api-facade.test.mjs` that
      imports `apps/control-plane/src/mongo-data-api.mjs` and asserts the
      module exports `mongoDataApiRequestContract`,
      `mongoDataApiResultContract`, `mongoDataApiEventContract`,
      `mongoDataApiRoutes`, and `summarizeMongoDataApiSurface` — fails today
      (file does not exist).
- [ ] 1.2 [test] Add a contract test that loads
      `apps/control-plane/openapi/families/mongo.openapi.json` and asserts
      a `mongo-data-api` tag with at least the `find`, `insertOne`,
      `updateMany`, `deleteOne`, and `aggregate` operation entries.
- [ ] 1.3 [test] Add a façade-coverage test that asserts the new façade
      re-exports the validators already implemented in
      `services/adapters/src/mongodb-data-api.mjs` (smoke-test calling each
      validator entry with a minimal valid payload).

## 2. Implementation

- [ ] 2.1 [spec] Add the `mongo-data-api` capability entry to
      `openspec/specs/data-services/spec.md` (or the equivalent
      capability-map file) referencing
      `services/adapters/src/mongodb-data-api.mjs` and the new façade.
- [ ] 2.2 [impl] Create `apps/control-plane/src/mongo-data-api.mjs` (~80
      LOC) mirroring `apps/control-plane/src/mongo-admin.mjs:1-112`; export
      the contract objects, route filter, audit-context fields, and
      `summarizeMongoDataApiSurface(context)`.
- [ ] 2.3 [impl] Extend
      `apps/control-plane/openapi/families/mongo.openapi.json` with a
      `mongo-data-api` tag and the operation entries listed above; tag the
      relevant paths in the spec.
- [ ] 2.4 [impl] Update `apps/control-plane/src/index.mjs` to re-export the
      new façade alongside the existing `mongo-admin.mjs` exports.

## 3. Docs and validation

- [ ] 3.1 [docs] Add a section to `apps/control-plane/src/README.md`
      describing the split between Mongo Admin and Mongo Data-API
      capabilities and pointing to both façades.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      complete-e1-data-api-capability-coverage --strict`; both green
      before merge.
