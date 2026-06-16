## Context

Falcone's document-store surface is live-wired through routes `/v1/collections/{name}/documents`, `/v1/collections/{name}/query`, and `/v1/collections/{name}/search` handled by `apps/control-plane/src/runtime/mongo-data-executor.mjs`. Tenant scoping is applied in `services/adapters/src/mongodb-data-api.mjs` via the default `tenantId` field. The real-stack test harness (`tests/env/`) starts a MongoDB-compatible container and exports its URI via environment variables. After the FerretDB/DocumentDB migration, the same env vars are the only integration point; no source or chart changes are needed to swap the backend for validation purposes.

The migrated backend runs `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` (DocumentDB on Postgres) fronted by `ghcr.io/ferretdb/ferretdb:2.7.0`.

Known FerretDB v2 findings (verified against the migration spike `add-ferretdb-adr-spike`, live on ferretdb:2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0):
- **No change streams**: `watch()` → CommandNotSupported (error 115); `changeStreamPreAndPostImages` → UnknownBsonField (error 40415). Realtime/CDC capability (`tests/e2e/realtime/tenant-isolation.test.mjs`, `tests/blackbox/cdc-*.test.mjs`) is broken; remediation is tracked in `add-ferretdb-realtime-cdc-remediation`. These exact error codes must be pinned in the probe assertions.
- **No multi-document transactions (deterministic failure)**: commit → CommandNotFound (error 59); abort is a SILENT NO-OP — data written in an aborted transaction is NOT rolled back. This is a correctness hazard. The smoke must assert the exact error 59 on commit AND probe that abort does not roll back, recording both as data-integrity findings with ADR-14 references. There is no "either succeeds" branch.
- **Same-namespace `$lookup` (≤1 join) and `$facet` (≤4 sub-pipelines): SUPPORTED** — these must return HTTP 200; a waiver path for these operators would mask regressions. The ≤1 / ≤4 caps are enforced by the adapter allowlist in `services/adapters/src/mongodb-data-api.mjs`, not by FerretDB.
- **Cross-database `$lookup`: REJECTED** — returns Location40321; the smoke must assert this exact code.
- **Isolation gap — no per-database role scoping**: a tenant_a credential can read tenant_b data at the DocumentDB backend level. The app-layer `tenantId` field filter in `services/adapters/src/mongodb-data-api.mjs` is the SOLE enforced boundary. This go/no-go gate does not assume a backend security boundary exists. ADR-14 records this decision. Note: `apps/control-plane/src/postgres-applier.mjs` manages schemas/tables/views/extensions/grants only — it has no Mongo role/createUser/db-scoping logic and does NOT provision per-tenant DocumentDB identities.
- **Engine-first startup (pinned version pair)**: the `postgres-documentdb:17-0.107.0-ferretdb-2.7.0` container must be healthy before `ferretdb:2.7.0` starts. The validation runner must enforce this ordering and must not connect until both containers report healthy.

Existing test baseline to extend/mirror:
- `tests/contracts/mongodb-data-api.compatibility.test.mjs`
- `tests/adapters/mongodb-data-api.test.mjs`
- `tests/env/executor/mongo-data-executor.test.mjs`

## Goals / Non-Goals

**Goals:**

- Automated document-parity check: compare every migrated collection's document count and checksum per tenant between source (MongoDB) and destination (FerretDB/DocumentDB) using the migration manifest.
- Per-tenant document-store-API smoke for tenants A and B through Falcone's live API surface, confirming each tenant can insert, list, query, and search documents, and that risk areas are exercised.
- Risk-area coverage: same-namespace `$lookup` (≤1 join — SUPPORTED, must return 200), `$facet` (≤4 sub-pipelines — SUPPORTED, must return 200), cross-database `$lookup` (REJECTED, Location40321 asserted), `$group` (SUPPORTED), unique/sparse/TTL index behavior (all SUPPORTED), transaction commit (CommandNotFound 59 asserted) and abort (silent no-op asserted as partial-write hazard).
- Realtime/CDC probe: assert exact error codes (watch → 115, changeStreamPreAndPostImages → 40415) with ADR-14 references; no generic "unsupported" check.
- Isolation-gap probe: confirm app-layer `tenantId` filter is the sole enforced boundary; record that DocumentDB per-database role scoping does NOT enforce cross-tenant denial.
- Cross-tenant NEGATIVE probe: Tenant A must be denied access to Tenant B's documents (HTTP 403 or 404).
- Single entrypoint runnable from `tests/env/`; passes or fails without manual interpretation.
- Result is green in `bash tests/blackbox/run.sh` and the CI `quality` job when the FerretDB-backed env is active (supported checks must pass; deterministic-failure checks must assert exact error codes; no silent skips).
- Validation runner enforces engine-first startup: postgres-documentdb healthy before ferretdb, both healthy before any test connects.

**Non-Goals:**

- Full Playwright E2E (separate change).
- Performance / throughput benchmarking (future work).
- Modifying any source file, Helm chart, or `tests/env/docker-compose.yml`.

## Decisions

### D1: Env-var-only backend swap

**Decision**: The FerretDB endpoint is provided by overriding the MongoDB URI env var at test-runner invocation time; `tests/env/env.sh` is consumed read-only.

**Rationale**: Matches the existing convention. No harness code changes needed; CI can set the var to point at FerretDB without touching docker-compose.

**Alternative considered**: A separate docker-compose override file. Rejected because it couples the validation change to the infra layer and requires an additional file outside `openspec/`.

### D2: Migration manifest as parity source-of-truth

**Decision**: The parity checker consumes the document-count + checksum manifest produced by `add-ferretdb-data-migration-runbook`. It does not re-read the MongoDB source directly unless the manifest is absent.

**Rationale**: Re-reading MongoDB at cutover time risks detecting documents written AFTER the migration snapshot, producing false positives. The manifest captures the authoritative migration snapshot.

**Alternative considered**: Live diff (MongoDB ListCollections vs FerretDB ListCollections). Retained as fallback mode when no manifest is present.

### D3: Two-tenant fixture alignment

**Decision**: The smoke suite provisions tenants A and B using the same fixture convention as the existing `tests/env/` flows. The cross-tenant probe is a NEGATIVE assertion (A must be denied on B's documents).

**Rationale**: Consistent with the repo's isolation-probe convention; maximises reuse of existing tenant-provisioning helpers.

### D4: Fail-closed on parity discrepancy; ADR-14 for waivers

**Decision**: The parity checker exits non-zero and prints a structured report on any discrepancy not present in a reviewed exception list. A zero exit means 100% parity. Any risk-area check that cannot pass due to a FerretDB v2 limitation must reference ADR-14 explicitly; silent skips are disallowed.

**Rationale**: Makes CI integration straightforward (exit code = gate). Exception list and ADR-14 references are explicit and auditable.

## Risks / Trade-offs

- [Same-namespace `$lookup`/`$facet` must return 200] These are SUPPORTED; a waiver path would mask regressions → The smoke requires HTTP 200; no waiver option for these operators.
- [Cross-database `$lookup` rejection] Returns Location40321 → Assert this exact code; treat any other error as a new failure.
- [No change streams — exact errors] CDC watch → 115, changeStreamPreAndPostImages → 40415 → Pin codes in assertions; a different error code means a new finding.
- [Transaction abort silent no-op] Data written in an aborted transaction is NOT rolled back — correctness hazard → Smoke must probe this explicitly: write, abort, read-back and assert data is still present; record as ADR-14 data-integrity finding.
- [Transaction commit CommandNotFound 59] Deterministic; assert exact error code rather than a "may fail" check.
- [Isolation gap — no backend role scoping] Tenant_a credential can read tenant_b at the DocumentDB layer → Probe must assert this gap is present (not a failure of the gate, but a recorded finding that app-layer scoping is the sole boundary); postgres-applier.mjs has no role-provisioning logic.
- [Engine-first startup] ferretdb:2.7.0 requires postgres-documentdb to be healthy first → Runner enforces health-check ordering; failure here blocks all tests.
- [Tenant fixture teardown] If the validation run aborts mid-way, Tenant B documents may remain accessible cross-tenant → Mitigation: teardown hook mirroring `tests/env/down.sh`.
- [Checksum format] FerretDB/DocumentDB may produce different ObjectId or BSON checksums than MongoDB → Mitigation: use document-count as primary parity metric; use content hash (JSON-serialised canonical form) as secondary.

## Open Questions

- OQ1: Does the `add-ferretdb-data-migration-runbook` manifest use document count + content hash or ObjectId ranges? The parity checker must match the format. Resolve before implementing D2.
- OQ2: FerretDB v2 connection port in the `tests/env/` harness — confirm it does not collide with the existing MongoDB port.
- OQ3: RESOLVED (ADR-14, merged): transaction commit → CommandNotFound (59); abort is a SILENT NO-OP that does NOT roll back data. Waiver messages must use exact error code 59 and flag the abort-no-rollback as a data-integrity finding, not a "degradation".
