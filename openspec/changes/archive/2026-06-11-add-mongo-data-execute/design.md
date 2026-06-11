## Context

`services/adapters/src/mongodb-data-api.mjs::buildMongoDataApiPlan` (line 2190) builds
a complete command plan for every Mongo data-API operation — including the merged tenant
predicate (`applyTenantScopeToFilter`, line 620), document-level tenant stamping on
inserts, and active 403 rejection of forged tenant fields (`validateTenantPredicate`,
line 600). No code in the control-plane ever passed these plans to the `mongodb` driver;
the routes existed in `server.mjs` but the `mongoExecutor` parameter was unset, so every
Mongo data-API call returned 501.

The Postgres executor (`add-postgres-data-crud-execute`) provided the pattern: the
adapter builds; the executor drives. Mongo has no SET ROLE / RLS; the adapter's
filter injection is the sole isolation mechanism.

## Goals / Non-Goals

**Goals:**
- Implement `createMongoExecutor({resolveUri})` + `executeMongoData(params)` in
  `apps/control-plane/src/runtime/mongo-data-executor.mjs`.
- Support operations: `list` (find+sort+limit), `get` (findOne), `insert` (insertOne),
  `update` (updateOne), `replace` (replaceOne), `delete` (deleteOne).
- Lazy-connect a `MongoClient` per URI; cache it across requests within a process.
- Wire the executor into `server.mjs` via `runMongo`; instantiate it from `main.mjs`
  when `MONGO_URI` or `MONGO_HOST` is present.
- Prove correctness with `tests/env/executor/mongo-data-executor.test.mjs` (real Mongo
  replica set at `tests/env`).

**Non-Goals:**
- `aggregate`, `bulk_write`, `change_stream`, `transaction` execution (deferred).
- Import/export execution (deferred).
- Mongo resource admin (collection creation, index management, view management).
- Console UI for Mongo data browsing.
- Connection pooling beyond the lazy per-URI cache (follow-on).

## Decisions

**D1 — Executor-over-adapter-plans (mirrors Postgres phase).**
`buildMongoDataApiPlan` already validates the operation, sanitizes field names, applies
the tenant predicate, and builds the driver-ready `query` and `write` objects. The
executor trusts the plan output and does not re-validate; this keeps isolation logic in
one place (the adapter) and the executor thin.

**D2 — Tenant isolation via adapter filter injection; RLS N/A for Mongo.**
MongoDB has no database-level role separation or row-level security. The adapter's
`applyTenantScopeToFilter` merges `{tenantId: <verified>}` into every query filter and
stamps the field on inserted documents. A forged `tenantId` in an insert payload is
rejected by `validateTenantPredicate` (403) before the driver call. The executor does
not add a second predicate; the plan is the contract.

**D3 — Lazy MongoClient cache keyed by URI.**
A new `MongoClient` is created and connected on first use for each URI; subsequent calls
reuse the cached client. This avoids the overhead of a full connection pool for the
initial phase while keeping the executor stateless from the caller's perspective.

**D4 — Opaque 500 on unhandled driver errors; never leak driver internals.**
All driver exceptions that are not already tagged with a `statusCode` are caught, logged
server-side (with a correlation reference), and re-thrown as `{statusCode:500,
code:"MONGO_ERROR"}` without exposing the original message. This is consistent with the
Postgres executor's error-mapping policy.

**D5 — 501 when no executor is configured.**
`runMongo` in `server.mjs` checks `if (!mongoExecutor)` and throws
`{statusCode:501, code:"MONGO_DISABLED"}` before calling the executor. This allows a
Postgres-only deployment to coexist with the Mongo routes in the route table.

## Risks / Trade-offs

**Risk: The lazy MongoClient is not closed on unhandled process exit.**
Mitigation: `main.mjs` calls `mongoExecutor.close()` in the shutdown handler; graceful
exit is covered. Crash exit may leak the connection; this is acceptable at this phase.

**Risk: Replica-set requirement for the test environment.**
Mitigation: `tests/env/executor/run-mongo.sh` starts a single-node replica set
(`rs0`, port 57017). Multi-document transactions are not used in Phase 1, so a
three-node set is not required.

**Risk: No connection pool limits; a burst could exhaust MongoDB connections.**
Mitigation: Phase 1 handles one URI per workspace; connection-level limits are a
follow-on concern once connection-registry parity with the Postgres side is reached.
