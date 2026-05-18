## Why

The Mongo admin validator allows view-pipeline stages that break tenant
isolation, lets view source collections reach across scope, and stores
arbitrary user-supplied objects as opaque index options. From
`openspec/audit/cap-e1-mongodb-admin.md`:

- **B6** (`services/adapters/src/mongodb-admin.mjs:1147-1155`) — `validateViewRequest`
  blocks `$out` and `$merge` but allows `$lookup`, `$facet`, `$unionWith`,
  `$function`, `$javascript`, and `$accumulator`. On older Mongo or with
  server-side scripting enabled, `$function` is arbitrary JS execution;
  `$lookup` reaches into other collections; `$unionWith` reaches across
  databases. None of these honour the adapter's tenant scoping.
- **B7** (`services/adapters/src/mongodb-admin.mjs:1135-1136`) — `sourceCollectionName`
  for views is required but never validated against the known collections in
  the same database or against the workspace's prefix scope. A view can
  reference a collection in a different database.
- **B8** (`services/adapters/src/mongodb-admin.mjs:615-616,1080`) — index
  `partialFilterExpression` and `collation` pass through as opaque
  user-supplied objects. Safe in this pure-validator adapter, but a hot
  potato for the executor and a missing surface check.
- **G6** (`G-S2.4`) — same as B8, called out as a separate finding.
- **G12** (`G-S2.5`) — `MONGO_RESERVED_COLLECTION_PREFIXES` only includes
  `system.`. Newer Mongo internal namespaces (`enxcol_.*`, `oplog.*`) are not
  blocked.

## What Changes

- Add a `BANNED_VIEW_PIPELINE_OPERATORS` allowlist set to
  `{$lookup, $facet, $unionWith, $function, $javascript, $accumulator,
   $out, $merge}` and reject any view whose pipeline references any of them
  via deep walk (operators may appear nested under `$facet` etc.).
- Add a `sourceCollectionName` check in `validateViewRequest` that requires
  the source to start with `profile.namingPolicy.collectionPrefix` when
  defined (i.e., live in the same workspace) and reside in the same database.
- Add a strict-form validator for `partialFilterExpression` (operators
  allowlisted to comparison + logical) and `collation` (only Mongo-documented
  fields with type checks); reject anything else with
  `MONGO_INDEX_OPTION_INVALID`.
- Extend `MONGO_RESERVED_COLLECTION_PREFIXES` to include `system.`,
  `enxcol_.`, `oplog.`, and `replset.`; the validator already blocks
  `system.*` — broaden the check to use `.some(prefix =>
  name.startsWith(prefix))`.

## Capabilities

### Modified Capabilities

- `data-services`: Mongo view-pipeline operator allowlist, view source
  collection scope check, index-option allowlists, and reserved-collection
  prefix list.

## Impact

- **Affected code**: `services/adapters/src/mongodb-admin.mjs` (view
  validator at `:1122-1160`, index validator at `:1075-1090`, constants
  `MONGO_RESERVED_COLLECTION_PREFIXES`), `tests/adapters/mongodb-admin.test.mjs`
  (new pipeline + index-option cases).
- **Migration required**: none.
- **Breaking changes**: any existing view or index whose definition relies
  on the now-banned operators or unknown index-option fields will fail
  validation when re-validated; existing rows in the executor's Mongo
  remain untouched until they're modified through the adapter.
- **Out of scope**: server-side enforcement of these constraints (the
  adapter is a pure validator); enforcing the same operator allowlist in
  the data-API adapter is tracked under `complete-e1-data-api-capability-
  coverage`.
