## Why

`apps/control-plane/src/runtime/mongo-data-executor.mjs` and the plan builder `services/adapters/src/mongodb-data-api.mjs` target a MongoDB-wire-compatible backend via `MONGO_URI`. The current real-stack test environment (`tests/env/docker-compose.yml`) runs `mongo:7 --replSet rs0` on port 57017. As part of the MongoDB→FerretDB+DocumentDB migration (epic #454), the data-access layer must be repointed at a FerretDB gateway backed by PostgreSQL DocumentDB.

The compatibility spike (ADR-14, `add-ferretdb-adr-spike`) confirmed on FerretDB 2.7.0 / postgres-documentdb 17-0.107.0-ferretdb-2.7.0 that: (a) ALL 15 adapter-allowed aggregation stages are fully functional — there is no engine-level unsupported-operator gap among the stages the adapter permits; (b) `$out`, `$merge`, and `$geoNear` are accepted by the engine but blocked by Falcone's existing adapter `AGGREGATION_BLOCKED_STAGES` allowlist as intentional **policy**, not engine limitation; (c) multi-document transactions are completely unsupported — `commitTransaction` → CommandNotFound(59), individual ops dispatched before commit **already persist** non-atomically, and `abortTransaction` is a silent no-op (no rollback); (d) `readConcern:'snapshot'` and `writeConcern:'majority'` declared in `mongodb-data-api.mjs` cannot be honored by FerretDB; (e) cross-DB `$lookup` is rejected by the engine (Location40321); (f) app-layer `tenantId` injection (`applyTenantScopeToFilter`/`injectTenantIntoDocument`) is the **authoritative** tenant boundary.

## What Changes

- Repoint `MONGO_URI` (resolved as `mongoUri` in `apps/control-plane/src/runtime/main.mjs`) at the FerretDB Service (`ghcr.io/ferretdb/ferretdb:2.7.0`) backed by the DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`). Docker-compose startup order: DocumentDB engine first (healthcheck), FerretDB gateway `depends_on` engine healthcheck.
- DROP the invented `FERRETDB_UNSUPPORTED_OPERATOR` shim and "partial $lookup/$facet support" premise — the spike proved all 15 adapter-allowed stages are fully functional. No new shim is needed. The existing adapter `AGGREGATION_BLOCKED_STAGES` ($out, $merge, $geoNear) remains unchanged; annotate it as intentional **policy** (not engine limitation).
- Strip `readConcern:'snapshot'` and `writeConcern:'majority'` from `mongodb-data-api.mjs` transaction paths — they are silently meaningless on FerretDB and must not be carried forward unflagged.
- Reject multi-document `transaction` ops **at the API boundary before any op runs** via `resolveMongoDataCapabilityCompatibility` with `supportsTransactions=false`, shimming to single-document atomic ops or dropping the transaction op. REMOVE any lazy/commit-time 501 probe — ops dispatched before commit already persisted non-atomically and abort is a no-op, so a commit-time guard leaves partial writes committed.
- App-layer `tenantId` injection (`applyTenantScopeToFilter`/`injectTenantIntoDocument`) is the **authoritative** tenant boundary. Per-tenant DocumentDB roles (`add-ferretdb-tenant-isolation-credentials`) are complementary defense-in-depth, NOT the primary boundary.
- Update `tests/env/docker-compose.yml` to run the FerretDB+DocumentDB stack (FerretDB gateway on the same port 57017) instead of `mongo:7 --replSet rs0`; gateway `depends_on` DocumentDB engine healthcheck.
- Keep the tenant-facing `/v1/collections/*` request/response shapes identical; no route changes in `services/gateway-config/public-route-catalog.json`.
- Close the open questions about $facet/$lookup: no engine divergence found; the $facet≤4/$lookup≤1 caps are adapter policy, not engine constraints.

## Capabilities

### New Capabilities

_(none — this change is a backend cutover; no new tenant-facing routes are added)_

### Modified Capabilities

- `data-api`: MongoDB executor connection repointed at FerretDB; snapshot/majority read-write concerns stripped; transaction op rejected at API boundary before any op runs (supportsTransactions=false); `tests/env` docker-compose runs FerretDB+DocumentDB stack with engine-first startup order; tenant-facing `/v1/collections/*` contract unchanged; app-layer tenantId injection is the authoritative boundary.

## Impact

- **Code**: `apps/control-plane/src/runtime/mongo-data-executor.mjs`, `apps/control-plane/src/runtime/main.mjs`, `services/adapters/src/mongodb-data-api.mjs` (strip snapshot/majority concerns; boundary-guard for transactions via supportsTransactions=false)
- **Config / Env**: `MONGO_URI` repointed at FerretDB Service; `tests/env/docker-compose.yml`
- **Tests**: `tests/contracts/mongodb-data-api.compatibility.test.mjs`, `tests/contracts/mongodb-admin.compatibility.test.mjs`, `tests/adapters/mongodb-data-api.test.mjs`, `tests/env/executor/mongo-data-executor.test.mjs`
- **API contract**: `/v1/collections/*` routes unchanged; `services/gateway-config/public-route-catalog.json` not modified
- **Dependencies**: DEPENDS ON `add-ferretdb-adr-spike` (#455, compatibility audit), `add-ferretdb-gateway` (#456), `add-ferretdb-tenant-isolation-credentials` (#458). BLOCKS `add-ferretdb-migration-validation` (#460).
- **Out of scope**: change-stream/realtime paths (tracked in `add-ferretdb-realtime-cdc-remediation`); FerretDB engine/gateway deployment (tracked in `add-ferretdb-documentdb-engine`, `add-ferretdb-gateway`).
