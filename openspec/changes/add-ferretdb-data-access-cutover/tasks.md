## 1. Failing Black-Box Test (test-first gate)

- [ ] 1.1 Add a failing assertion to `tests/env/executor/mongo-data-executor.test.mjs` that a `transaction` op against FerretDB returns HTTP 501 with `code: "TRANSACTION_NOT_SUPPORTED"` and that no individual ops are dispatched — confirm it fails on the unmodified codebase
- [ ] 1.2 Add a failing assertion to `tests/adapters/mongodb-data-api.test.mjs` that a plan built for a FerretDB backend carries no `readConcern:'snapshot'` or `writeConcern:'majority'` field — confirm it fails on the unmodified codebase
- [ ] 1.3 Confirm both new assertions fail when run against the current `mongo:7` or unmodified adapter code

## 2. Strip snapshot/majority Read-Write Concerns for FerretDB

- [ ] 2.1 In `services/adapters/src/mongodb-data-api.mjs`, remove or omit `readConcern:'snapshot'` and `writeConcern:'majority'` from operation plans dispatched to a FerretDB-targeted backend — these concerns are silently ignored by FerretDB and must not be carried forward
- [ ] 2.2 Add unit assertions in `tests/adapters/mongodb-data-api.test.mjs` that the built plan for a FerretDB backend contains no snapshot or majority concern fields

## 3. Reject Transaction Ops at the API Boundary Before Any Op Runs

- [ ] 3.1 Add or update `resolveMongoDataCapabilityCompatibility` (or equivalent compatibility resolution) in `apps/control-plane/src/runtime/mongo-data-executor.mjs` or the plan builder to expose `supportsTransactions=false` when the connected backend is FerretDB
- [ ] 3.2 In the plan builder or the executor's dispatch path, reject any `transaction` op at the API boundary (before any individual op within the transaction is dispatched) when `supportsTransactions=false`, returning HTTP 501 with `code: "TRANSACTION_NOT_SUPPORTED"`
- [ ] 3.3 Confirm the guard fires BEFORE any individual op is sent to FerretDB — a commit-time or lazy guard is NOT acceptable (ops already persist non-atomically and abort is a no-op)
- [ ] 3.4 Add a test assertion in `tests/env/executor/mongo-data-executor.test.mjs` that the transaction op returns 501 and no individual ops are dispatched to the FerretDB stack

## 4. Verify Adapter Blocked-Stage Policy and Allowlist (No New Shim Needed)

- [ ] 4.1 Confirm `AGGREGATION_BLOCKED_STAGES` ($out, $merge, $geoNear) in `services/adapters/src/mongodb-data-api.mjs` is unchanged and annotate (comment) that these stages are blocked by **adapter policy**, not engine limitation
- [ ] 4.2 Confirm the $facet≤4 and $lookup≤1 caps are unchanged and annotate as adapter policy
- [ ] 4.3 Confirm no `FERRETDB_UNSUPPORTED_OPERATOR` error code or shim has been introduced — the spike proved all allowed stages are engine-functional; drop any draft implementation of this shim

## 5. Update tests/env docker-compose to FerretDB+DocumentDB Stack with Engine-First Startup

- [ ] 5.1 In `tests/env/docker-compose.yml`, replace the `mongo:7 --replSet rs0` service with two services: the DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) and the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`)
- [ ] 5.2 Configure the FerretDB gateway to listen on port 57017 (same external port as the replaced mongo:7 mapping)
- [ ] 5.3 Wire the FerretDB gateway to the DocumentDB Postgres backend via `FERRETDB_POSTGRESQL_URL`
- [ ] 5.4 Add a healthcheck for the DocumentDB engine service; configure the FerretDB gateway service with `depends_on: <engine>: condition: service_healthy` so the engine is healthy before the gateway starts
- [ ] 5.5 Add a healthcheck for the FerretDB gateway service so test env startup gating waits for it to be ready
- [ ] 5.6 Update `MONGO_URI` in the test env configuration to point at the FerretDB gateway service

## 6. Verify tenantId Injection as Authoritative Boundary

- [ ] 6.1 Verify `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs` are called on every read, update, replace, delete, and insert plan path with no bypass
- [ ] 6.2 Add or confirm test assertions in `tests/adapters/mongodb-data-api.test.mjs` that tenantId injection is applied on every plan path and is independent of per-tenant DocumentDB credential state
- [ ] 6.3 Confirm no code path describes per-tenant DocumentDB roles as "primary" isolation — app-layer injection is primary; roles are defense-in-depth

## 7. MONGO_URI Connection Repoint

- [ ] 7.1 In `apps/control-plane/src/runtime/main.mjs`, verify `mongoUri` resolution reads exclusively from `MONGO_URI` (or `MONGO_HOST` fallback) and requires no code change beyond the env value itself
- [ ] 7.2 Update any example env files or chart value references (in `add-ferretdb-gateway` scope if applicable) to reflect the FerretDB gateway URI format

## 8. Contract and Test Suite Verification

- [ ] 8.1 Run `tests/contracts/mongodb-data-api.compatibility.test.mjs` against the FerretDB stack — confirm all assertions pass
- [ ] 8.2 Run `tests/contracts/mongodb-admin.compatibility.test.mjs` against the FerretDB stack — confirm all assertions pass
- [ ] 8.3 Run `tests/adapters/mongodb-data-api.test.mjs` — confirm all assertions pass including concern-stripping and tenantId-injection assertions
- [ ] 8.4 Run `tests/env/executor/mongo-data-executor.test.mjs` against the FerretDB stack (docker-compose up) — confirm CRUD, aggregation, transaction-boundary-rejected (501), and no-ops-dispatched assertions pass
- [ ] 8.5 Run `bash tests/blackbox/run.sh` — confirm all contract assertions for `/v1/collections/*` routes pass with no schema violations (contract unchanged)
