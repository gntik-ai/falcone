## 1. Failing black-box test

- [x] 1.1 Add a black-box test: insert a document, then `GET …/documents/{insertedId}`, asserting the document is found. Confirm RED (`{found:false}` today). — real-stack proof in `tests/env/executor/mongo-data-executor.test.mjs` ("by-id round-trip works for an auto-generated ObjectId"); RED confirmed with the fix reverted (`found:false`), GREEN after. Deterministic helper coverage in `tests/unit/mongo-data-executor-objectid.test.mjs`.
- [x] 1.2 Add a black-box test: DELETE by a real id returns `deleted:1` and the document is gone. — same env test asserts `delete → deleted:1` then `get → found:false`.

## 2. Fix id coercion

- [x] 2.1 In the mongo executor by-id handlers, coerce `_id` to `ObjectId` (with a string fallback for ids that are not valid ObjectIds) before querying. — `apps/control-plane/src/runtime/mongo-data-executor.mjs::coerceDocumentIdFilter`, applied to get/update/replace/delete. Coercion lives in the executor (the `mongodb` driver boundary) so the pure adapter plan stays serializable. A 24-hex id matches EITHER the `ObjectId` or the raw string (`$or`), descending through the adapter's `$and` so the tenant predicate is never widened; non-ObjectId ids are left as strings.

## 3. Verify

- [x] 3.1 Re-run the round-trip black-box test — confirm get/update/replace/delete by id work and DELETE removes the document. — full `tests/env/executor/mongo-data-executor.test.mjs` suite GREEN against FerretDB (10/10), incl. a cross-tenant negative (coercion does not widen tenant scope).
- [x] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions. — 630/630 pass; mongo-adjacent unit/adapter/contract suites 19/19 pass.
