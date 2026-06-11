## Implementation status (Phase 1 — DONE)

Implemented + proven against real Mongo (`bash tests/env/executor/run-mongo.sh`):
- Document CRUD (list/get/insert/update/replace/delete) executed via the adapter plan in
  `apps/control-plane/src/runtime/mongo-data-executor.mjs` under the caller's tenant
  scope; insert stamps the verified `tenantId` (anti-forge) via the adapter.
- HTTP routes wired in `apps/control-plane/src/runtime/server.mjs`: six routes covering
  `GET/POST` on the collection path and `GET/PATCH/PUT/DELETE` on the document path.
- `main.mjs` instantiates the executor when `MONGO_URI` or `MONGO_HOST` is set.
- `package.json` adds the `mongodb` driver dependency.
- Tests (7/7): insert tenant-injected, forged tenant rejected (403), tenant-scoped
  list / filter / get / update / delete, 401 on missing identity.

DEFERRED: aggregate / bulk_write / change_stream / transaction execution; Mongo resource
admin (collection / index / view management); console UI for Mongo data browsing.

## 1. Baseline

- [ ] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] T02 Confirm `openspec validate add-mongo-data-execute --strict` passes

## 2. Black-box tests (write first; must be red before implementation)

- [ ] T03 Write failing test `bbx-mongo-insert-list`: insert a document via
  `POST /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents`, then
  `GET` the same path; assert the document appears in the list response
- [ ] T04 Write failing test `bbx-mongo-tenant-scope-list`: insert documents for
  two tenants into the same collection; assert each tenant's list returns only its own
  documents
- [ ] T05 Write failing test `bbx-mongo-cross-tenant-get`: tenant A requests the `_id`
  of a document owned by tenant B; assert `found: false`
- [ ] T06 Write failing test `bbx-mongo-forged-tenant-rejected`: tenant A inserts a
  document with `tenantId` set to tenant B; assert HTTP 403 and document count unchanged
- [ ] T07 Write failing test `bbx-mongo-update-scoped`: tenant A updates a document
  owned by tenant B using its `_id`; assert `matched: 0` and document unmodified
- [ ] T08 Write failing test `bbx-mongo-delete-scoped`: tenant A deletes a document
  owned by tenant B using its `_id`; assert `deleted: 0` and document still present
- [ ] T09 Write failing test `bbx-mongo-no-identity-401`: list request with no identity
  headers and no API key; assert HTTP 401
- [ ] T10 Write failing test `bbx-mongo-disabled-501`: request to Mongo endpoint when
  executor is not configured; assert HTTP 501 with `code: "MONGO_DISABLED"`
- [ ] T11 Confirm all T03–T10 are red against the current codebase before implementation

## 3. Executor implementation

- [ ] T12 Implement `createMongoExecutor({resolveUri})` in
  `apps/control-plane/src/runtime/mongo-data-executor.mjs`:
  - Lazy-connect a `MongoClient` per URI (cached in `Map`); expose `close()` for shutdown
  - Guard: if `!tenantId` throw 401 `IDENTITY_MISSING`; if `!workspaceId` throw 400
  - Call `buildMongoDataApiPlan` to produce the plan; surface adapter errors as 400/403
  - Resolve the workspace URI via `resolveUri(workspaceId)`; throw 503 when absent
- [ ] T13 Implement `list` branch: `collection.find(filter,{projection}).sort().limit().toArray()`
- [ ] T14 Implement `get` branch: `collection.findOne(filter,{projection})`; return `found`
- [ ] T15 Implement `insert` branch: `collection.insertOne(plan.write.document)`; return
  the inserted document merged with the driver-assigned `_id`
- [ ] T16 Implement `update` branch: `collection.updateOne(filter, update, {upsert})`
- [ ] T17 Implement `replace` branch: `collection.replaceOne(filter, replacement, {upsert})`
- [ ] T18 Implement `delete` branch: `collection.deleteOne(filter)`
- [ ] T19 Catch all untagged driver errors; re-throw as `{statusCode:500, code:"MONGO_ERROR"}`
  without leaking the raw driver message to the caller

## 4. Route wiring

- [ ] T20 Add `runMongo(mongoExecutor, params, successStatus)` helper to `server.mjs`:
  returns 501 `MONGO_DISABLED` when `mongoExecutor` is falsy
- [ ] T21 Wire `GET` (list) and `POST` (insert) on the collection path
  (`/v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents`)
- [ ] T22 Wire `GET` (get), `PATCH` (update), `PUT` (replace), `DELETE` (delete) on the
  document path (`.../documents/{id}`)
- [ ] T23 Instantiate `createMongoExecutor` in `main.mjs` when `MONGO_URI` or `MONGO_HOST`
  is set; pass it to `createControlPlaneServer`; call `mongoExecutor.close()` on shutdown

## 5. Integration verification

- [ ] T24 Run `bash tests/env/executor/run-mongo.sh`; confirm all 7 real-Mongo tests pass
- [ ] T25 Run `bash tests/blackbox/run.sh`; confirm T03–T10 pass (green) and existing
  tests are unaffected
- [ ] T26 Run `openspec validate add-mongo-data-execute --strict`
