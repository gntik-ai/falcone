> IMPLEMENTATION NOTES (code-verified):
> - The capability resolver `resolveMongoDataCapabilityCompatibility` already rejected
>   transactions on `supportsTransactions===false` (409); this change adds a distinct
>   boundary **501 `TRANSACTION_NOT_SUPPORTED`** guard in `buildMongoDataApiPlan`'s
>   transaction branch (fires before any op, regardless of clusterTopology).
> - The backend signal is plumbed: `MONGO_BACKEND=ferretdb` → `main.mjs` builds
>   `topology:{supportsTransactions:false}` → `createMongoExecutor({topology})` →
>   `buildMongoDataApiPlan({topology})`. CRUD/aggregate ignore topology (unaffected).
> - snapshot/majority concerns ride ONLY transaction ops, which FerretDB rejects → no
>   FerretDB plan carries them; annotated as MongoDB-only (the rejection subsumes stripping).
> - CI `real-stack` runs `tests/env/executor/run.sh` (postgres-only); the mongo/realtime
>   path runs via `run-mongo.sh` (not CI), so the docker-compose swap doesn't break CI.

## 1. Failing Black-Box Test (test-first gate)

- [x] 1.1 Added a transaction-501 assertion to `tests/env/executor/mongo-data-executor.test.mjs`
      (501 `TRANSACTION_NOT_SUPPORTED`, no individual op persists).
- [x] 1.2 Added an assertion in `tests/adapters/mongodb-data-api.test.mjs` that a FerretDB plan
      carries no `readConcern:snapshot`/`writeConcern:majority`.
- [x] 1.3 Confirmed the transaction-501 adapter test FAILS on the unmodified code (it threw
      409/`mongo_data_capability_unavailable`, not 501/`TRANSACTION_NOT_SUPPORTED`).

## 2. Strip snapshot/majority Read-Write Concerns for FerretDB

- [x] 2.1 Annotated `MONGO_DATA_DEFAULT_TRANSACTION_LIMITS` (snapshot/majority are MongoDB-only;
      FerretDB rejects transactions at the boundary so these are never dispatched to it).
- [x] 2.2 Adapter assertion (1.2) confirms no FerretDB-dispatched plan carries the concerns.

## 3. Reject Transaction Ops at the API Boundary Before Any Op Runs

- [x] 3.1 `supportsTransactions=false` exposed for the FerretDB backend via the topology profile
      plumbed `main.mjs` → executor → `buildMongoDataApiPlan` (MONGO_BACKEND=ferretdb).
- [x] 3.2 `buildMongoDataApiPlan` transaction branch throws 501 `TRANSACTION_NOT_SUPPORTED` when
      `supportsTransactions===false`.
- [x] 3.3 The guard fires at the top of the transaction branch, BEFORE
      `normalizeMongoTransactionPayload`/dispatch — no individual op is sent.
- [x] 3.4 Real-stack assertion (1.1) verifies 501 + no op persisted (run via run-mongo.sh).

## 4. Verify Adapter Blocked-Stage Policy and Allowlist (No New Shim Needed)

- [x] 4.1 `AGGREGATION_BLOCKED_STAGES` ($out,$merge,$geoNear) unchanged + annotated as adapter POLICY.
- [x] 4.2 $facet≤4 / $lookup≤1 caps unchanged + annotated as adapter policy.
- [x] 4.3 Confirmed no `FERRETDB_UNSUPPORTED_OPERATOR` shim exists (grep-verified; none added).

## 5. Update tests/env docker-compose to FerretDB+DocumentDB Stack with Engine-First Startup

- [x] 5.1 Replaced the `mongo:7 --replSet rs0` service with the FerretDB gateway
      (`ghcr.io/ferretdb/ferretdb:2.7.0`); the `documentdb` engine service (from #468, with
      the #471 `\connect postgres` fix) is the backend.
- [x] 5.2 FerretDB gateway listens on 57017 (same external port as the replaced mongo).
- [x] 5.3 `FERRETDB_POSTGRESQL_URL` → `documentdb:5432/postgres` (where the extension lives).
- [x] 5.4 `ferretdb depends_on documentdb: condition: service_healthy` (engine-first).
- [x] 5.5 ferretdb healthcheck via the debug endpoint (`wget .../debug/healthz`).
- [x] 5.6 `up.sh` (health gate + connection banner, rs.initiate removed) and `run-mongo.sh`
      (brings up documentdb+ferretdb engine-first, sets MONGO_URI + MONGO_BACKEND=ferretdb)
      updated.

## 6. Verify tenantId Injection as Authoritative Boundary

- [x] 6.1 `applyTenantScopeToFilter`/`injectTenantIntoDocument` are called on every plan path
      (unchanged by this cutover; verified in `buildMongoDataApiPlan`).
- [x] 6.2 Tenant-scoping assertions covered by the adapter tests + the real-stack executor
      tenant-scoped CRUD cases + the blackbox dual-isolation test.
- [x] 6.3 App-layer injection is documented as the AUTHORITATIVE boundary; per-tenant roles
      are defense-in-depth (proposal/design/spec all framed this way).

## 7. MONGO_URI Connection Repoint

- [x] 7.1 `mongoUri` in `main.mjs` reads `MONGO_URI`/`MONGO_HOST` only — no code change beyond
      the env value; the per-tenant resolver (#458) is unchanged.
- [x] 7.2 `run-mongo.sh` + `up.sh` set the FerretDB gateway URI; chart gateway URI is owned by
      `add-ferretdb-gateway` (FERRETDB_POSTGRESQL_URL there).

## 8. Contract and Test Suite Verification

- [x] 8.1 `tests/contracts/mongodb-data-api.compatibility.test.mjs` — pass.
- [x] 8.2 `tests/contracts/mongodb-admin.compatibility.test.mjs` — pass (4/4 combined).
- [x] 8.3 `tests/adapters/mongodb-data-api.test.mjs` — pass (11/11, incl. concern + 501 asserts).
      Also full `test:contracts` 232/0 and `test:unit` 688/0 (no regressions).
- [x] 8.4 `tests/env/executor/run-mongo.sh` against the live FerretDB docker-compose stack —
      ALL 9 executor tests pass against live FerretDB→DocumentDB: insert/list/get/update/
      delete tenant-scoping, keyset pagination, 401, and transaction-501 (no op dispatched).
      The live run also surfaced + fixed 3 latent #468/#469 bugs (shared_preload via command
      args; POSTGRES_DB=postgres for the image's bundled 20-install.sql; FerretDB distroless
      so no compose healthcheck + chart probes corrected to /debug/readyz+livez).
- [x] 8.5 `bash tests/blackbox/run.sh` — 565/565 (contract for /v1/collections/* unchanged).
