## Why

`services/adapters/src/mongodb-data-api.mjs::buildMongoDataApiPlan` (line 2190) produces a full command plan — `{operation, query:{filter,projection,sort,limit}, write:{document|update|replacement,upsert}}` — for every document CRUD call with the verified tenant predicate merged into every filter (`applyTenantScopeToFilter`, line 620) and stamped on inserts. A forged `tenantId` in the document payload is actively rejected with a 403 (`validateTenantPredicate`, line 600). No code path ever called the `mongodb` driver. This change adds the executor that runs those plans against the real driver, and wires the HTTP routes (`/v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents[/{id}]`).

## What Changes

- `apps/control-plane/src/runtime/mongo-data-executor.mjs` — `createMongoExecutor({resolveUri})` + `executeMongoData(params)`: builds the plan, drives `find/findOne/insertOne/updateOne/replaceOne/deleteOne` via the `mongodb` driver; lazy-cached `MongoClient` per URI.
- `apps/control-plane/src/runtime/server.mjs` — six routes (`GET/POST` collection, `GET/PATCH/PUT/DELETE` document) wired via `runMongo`; returns 501 when no executor is configured.
- `apps/control-plane/src/runtime/main.mjs` — instantiates `createMongoExecutor` when `MONGO_URI` or `MONGO_HOST` is set.

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-api`: MongoDB document CRUD plans produced by `buildMongoDataApiPlan` are now executed against the workspace MongoDB via the real driver; tenant isolation is enforced by the adapter's filter injection (Mongo has no RLS).

## Impact

- `apps/control-plane/src/runtime/mongo-data-executor.mjs` — new file (executor).
- `apps/control-plane/src/runtime/server.mjs` — six Mongo document routes added (`mdoc` pattern, `runMongo` helper).
- `apps/control-plane/src/runtime/main.mjs` — conditional `createMongoExecutor` initialization.
- `services/adapters/src/mongodb-data-api.mjs::buildMongoDataApiPlan` — reused unchanged as plan source.
- `tests/env/executor/mongo-data-executor.test.mjs` + `tests/env/executor/run-mongo.sh` — real-Mongo proof (7/7 green).
- `package.json` — `mongodb` driver added as a dependency.
