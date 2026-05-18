## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add `tests/adapters/mongodb-admin.view-pipeline.test.mjs`
      with a case validating a `create_view` request whose pipeline contains
      `{$lookup: {from: 'other_coll', …}}`; assert validation rejects with
      `MONGO_VIEW_PIPELINE_OPERATOR_BANNED` — fails today.
- [ ] 1.2 [test] Add a case asserting nested `$function` inside `$facet`'s
      sub-pipeline is also rejected (deep walk).
- [ ] 1.3 [test] Add a case validating a view whose `sourceCollectionName`
      does not start with the workspace prefix; assert rejection with
      `MONGO_VIEW_SOURCE_OUT_OF_SCOPE`.
- [ ] 1.4 [test] Add a case asserting an index `partialFilterExpression` with
      `{$where: '…'}` (non-allowlisted) is rejected with
      `MONGO_INDEX_OPTION_INVALID`.
- [ ] 1.5 [test] Add a case asserting a collection named `enxcol_.foo` is
      rejected by the reserved-prefix check (currently only `system.` is
      blocked).

## 2. Implementation

- [ ] 2.1 [fix] Replace the `$out`/`$merge` block at
      `services/adapters/src/mongodb-admin.mjs:1147-1155` with a deep walk
      that rejects any pipeline stage operator in
      `BANNED_VIEW_PIPELINE_OPERATORS = {$lookup, $facet, $unionWith,
      $function, $javascript, $accumulator, $out, $merge}`. Recurse into
      sub-pipelines under `$facet`.
- [ ] 2.2 [fix] In `validateViewRequest` (`mongodb-admin.mjs:1122-1160`)
      after sourceCollectionName presence check, when
      `profile.namingPolicy.collectionPrefix` is non-null assert
      `sourceCollectionName.startsWith(collectionPrefix)`; reject with
      `MONGO_VIEW_SOURCE_OUT_OF_SCOPE`.
- [ ] 2.3 [fix] Add `validatePartialFilterExpression(expr)` and
      `validateCollation(coll)` helpers; call them from
      `validateIndexRequest` (`mongodb-admin.mjs:1075-1090`). Reject any
      unknown operator or field with `MONGO_INDEX_OPTION_INVALID` carrying
      the offending JSONPath.
- [ ] 2.4 [fix] Broaden `MONGO_RESERVED_COLLECTION_PREFIXES` to
      `['system.', 'enxcol_.', 'oplog.', 'replset.']`; update
      `validateCollectionRequest` to use `.some(p => name.startsWith(p))`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the view-pipeline allowlist and index-option
      restrictions in `apps/control-plane/src/mongo-admin.mjs` JSDoc.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-e1-pipeline-validation --strict`; both green before merge.
