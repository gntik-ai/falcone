## Why

After the MongoDB-to-FerretDB v2 + DocumentDB data migration there is no automated gate that confirms document parity per tenant or that Falcone's document-store API behaves correctly against the migrated backend. Without these checks, the go/no-go decision relies on manual inspection, which is error-prone and cannot be wired into CI. The migration introduces concrete compatibility findings — FerretDB v2 lacks change streams (error 115) and multi-document transactions (commit → CommandNotFound 59; abort is a silent no-op that does NOT roll back written data), cross-database `$lookup` is rejected (Location40321), and per-database role scoping is not enforced (a tenant_a credential can read tenant_b data at the backend layer) — that must be exercised per tenant through Falcone's public interface before cutover is declared safe. Same-namespace `$lookup` (≤1 join) and `$facet` (≤4 sub-pipelines) are SUPPORTED by FerretDB v2; those caps are enforced by the adapter allowlist in `services/adapters/src/mongodb-data-api.mjs`, not by FerretDB itself.

Code evidence:
- `services/adapters/src/mongodb-data-api.mjs` — plan builder + tenant scoping (default tenant field `tenantId`); risk areas `$lookup`/`$facet`/`$group`, unique/sparse/TTL indexes, transaction op (snapshot/majority)
- `apps/control-plane/src/runtime/mongo-data-executor.mjs` — executor that runs document-store plans
- `tests/contracts/mongodb-data-api.compatibility.test.mjs` — existing compatibility baseline to extend
- `tests/adapters/mongodb-data-api.test.mjs` — adapter-level unit tests to mirror
- `tests/env/executor/mongo-data-executor.test.mjs` — real-stack executor tests to extend
- `tests/e2e/realtime/tenant-isolation.test.mjs` — CDC/realtime isolation probes (FerretDB v2 has NO change streams)
- `tests/blackbox/cdc-*.test.mjs` — CDC blackbox tests (affected by no-change-streams blocker)

## What Changes

- **NEW** document-parity checker: compares per-collection document counts and checksums between two seeded tenants (A/B) against the FerretDB/DocumentDB endpoint, consuming the migration manifest produced by `add-ferretdb-data-migration-runbook`; reports missing and mismatched documents and exits non-zero on any unreviewed discrepancy.
- **NEW** per-tenant document-store-API smoke suite for tenants A and B targeting the public routes `/v1/collections/{name}/documents`, `/v1/collections/{name}/query`, and `/v1/collections/{name}/search`, exercising the FerretDB v2 compatibility areas: aggregation `$lookup` (same-namespace, ≤1 join — SUPPORTED), `$facet` (≤4 sub-pipelines — SUPPORTED), `$group` (SUPPORTED), cross-database `$lookup` (REJECTED, Location40321), unique/TTL/sparse index behavior (all SUPPORTED), transaction commit (CommandNotFound 59) / abort (silent no-op — data NOT rolled back, a correctness hazard), CDC change-stream probe (CommandNotSupported 115; changeStreamPreAndPostImages → UnknownBsonField 40415), and the isolation-gap probe confirming app-layer `tenantId` scoping is the sole enforced boundary.
- **NEW** cross-tenant NEGATIVE probe: asserts that Tenant A receives HTTP 403 or HTTP 404 when attempting to read Tenant B's documents through the data API.
- **NEW** single-entrypoint runner wired into `tests/env/` that points at the FerretDB/DocumentDB backend via environment variable override, mirroring the convention in `tests/env/env.sh`.
- Supported risk-area checks (same-namespace `$lookup`, `$facet`, all index types) MUST return HTTP 200 — no waiver path exists for these, as a waiver would mask regressions. Deterministic failures (transaction commit → CommandNotFound 59, CDC watch → error 115, `changeStreamPreAndPostImages` → error 40415, cross-database `$lookup` → Location40321) are recorded with exact error codes and ADR-14 references rather than silently skipped.
- **NEW** isolation-gap probe and requirement: confirms that app-layer `tenantId` filter is the sole enforced boundary; records (ref ADR-14) that DocumentDB per-database role scoping does NOT enforce cross-tenant denial at the backend layer, so this go/no-go gate does not assume a backend security boundary exists. Note: `apps/control-plane/src/postgres-applier.mjs` manages schemas/tables/views/extensions/grants only — it contains no Mongo role/createUser logic and does not provision per-tenant DocumentDB identities.
- **NEW** engine-first startup note: the validation runner MUST start `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` before `ghcr.io/ferretdb/ferretdb:2.7.0` (the version pair is pinned); tests must not connect until both containers report healthy.

## Capabilities

### New Capabilities

- `document-store-migration-validation`: Document-parity checking and per-tenant document-store-API smoke testing against FerretDB v2 + DocumentDB, covering the migration risk areas (aggregation operators, index types, transaction deterministic-failure recording, CDC error-code recording, cross-database $lookup rejection, isolation-gap recording), engine-first startup ordering, integrated with the `tests/env/` real-stack harness and wired into CI.

### Modified Capabilities

- `data-api`: ADDED requirements for verifiable document parity after migration and per-tenant document-store-API correctness (including cross-tenant denial and risk-area coverage) against the FerretDB/DocumentDB backend.

## Impact

- `tests/env/env.sh` — consumed read-only; `MONGO_URI` / `FERRETDB_URI` override is the integration point.
- `apps/control-plane/src/runtime/mongo-data-executor.mjs` and `services/adapters/src/mongodb-data-api.mjs` — the executor and plan builder are the API surface under smoke test; no modifications to source.
- `tests/blackbox/run.sh` and CI `quality` job — validation entrypoint must remain green when the FerretDB-backed env is active.
- Informs rollback-plan go/no-go for the MongoDB-to-FerretDB cutover.
- **DEPENDS ON**: `add-ferretdb-data-access-cutover`, `add-ferretdb-realtime-cdc-remediation`, `add-ferretdb-data-migration-runbook`.
