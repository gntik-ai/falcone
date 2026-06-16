# document-store-migration-validation Specification

## Purpose
TBD - created by archiving change add-ferretdb-migration-validation. Update Purpose after archive.
## Requirements
### Requirement: Document-parity checker compares source and destination per collection and tenant

The system SHALL provide a document-parity checker that, given a migration manifest (per-collection document count and content checksum per tenant) produced by the data-migration runbook and the FerretDB/DocumentDB endpoint configured via environment variable, compares document counts and content checksums for every migrated collection across two seeded tenants (A and B) and produces a structured report of missing documents and checksum mismatches.

#### Scenario: All documents match — checker exits zero

- **WHEN** the parity checker runs against a FerretDB/DocumentDB endpoint where every document listed in the migration manifest is present with a matching content checksum for both tenant A and tenant B
- **THEN** the checker exits with code 0 and reports 100% parity with zero missing documents and zero mismatched checksums

#### Scenario: Missing document detected — checker exits non-zero

- **WHEN** the parity checker runs and one or more documents present in the migration manifest are absent from the FerretDB collection for a given tenant
- **THEN** the checker exits with a non-zero code and includes the missing document identifiers and the affected tenant in the structured output report

#### Scenario: Checksum mismatch detected — checker exits non-zero

- **WHEN** a document is present in the FerretDB collection but its content checksum differs from the value recorded in the migration manifest
- **THEN** the checker exits with a non-zero code and lists the mismatched document identifier with both the expected and actual checksum values

#### Scenario: Reviewed exception list suppresses known discrepancy

- **WHEN** a document appears in the migration manifest as mismatched or missing AND that document identifier is also present in the reviewed exception list
- **THEN** the checker does not count it as a failure, logs it as an accepted exception, and exits zero if no other discrepancies exist

### Requirement: Per-tenant document-store-API smoke exercises risk areas for tenants A and B against FerretDB

The system SHALL execute per-tenant document-store-API smoke tests for two tenants (A and B) against the FerretDB/DocumentDB-backed endpoint by exercising the live routes `POST /v1/collections/{name}/documents`, `GET /v1/collections/{name}/documents`, `POST /v1/collections/{name}/query`, and `GET /v1/collections/{name}/search` through `apps/control-plane/src/runtime/mongo-data-executor.mjs`, and the full suite SHALL pass for both tenants with no unexpected HTTP error responses.

#### Scenario: Tenant A can insert and list documents against FerretDB

- **WHEN** Tenant A's credentials are used to call `POST /v1/collections/{name}/documents` to insert a document and then `GET /v1/collections/{name}/documents` to list documents
- **THEN** the insert response is HTTP 201 and the list response is HTTP 200 and contains the inserted document scoped to Tenant A only

#### Scenario: Tenant B can query documents with filter and pagination against FerretDB

- **WHEN** Tenant B's credentials are used to call `POST /v1/collections/{name}/query` with an equality filter and a page size limit
- **THEN** the response is HTTP 200 and contains only documents matching the filter scoped to Tenant B, not exceeding the requested page size

#### Scenario: Aggregation $group operator executes against FerretDB

- **WHEN** Tenant A's credentials are used to call `POST /v1/collections/{name}/query` with a `$group` aggregation pipeline stage as implemented in `services/adapters/src/mongodb-data-api.mjs`
- **THEN** the response is HTTP 200 and returns grouped results scoped to Tenant A, or the failure is explicitly waived with an ADR-14 decision reference

#### Scenario: Aggregation $lookup (same-namespace, one join) returns correct results against FerretDB

- **WHEN** Tenant B's credentials are used to call `POST /v1/collections/{name}/query` with a `$lookup` stage joining at most one collection within the same database namespace, as permitted by the adapter allowlist in `services/adapters/src/mongodb-data-api.mjs`
- **THEN** the response is HTTP 200 and returns joined results scoped to Tenant B; no waiver is permitted for this scenario because same-namespace $lookup is SUPPORTED

#### Scenario: Cross-database $lookup is rejected with exact error code Location40321

- **WHEN** Tenant B's credentials are used to call `POST /v1/collections/{name}/query` with a `$lookup` stage referencing a collection in a different database namespace against the FerretDB backend
- **THEN** FerretDB returns an error response containing code Location40321 and the validation suite asserts this exact code as the confirmed and expected outcome

#### Scenario: Aggregation $facet (at most four sub-pipelines) returns correct results against FerretDB

- **WHEN** Tenant A's credentials are used to call `POST /v1/collections/{name}/query` with a `$facet` stage containing at most four sub-pipelines, as permitted by the adapter allowlist in `services/adapters/src/mongodb-data-api.mjs`
- **THEN** the response is HTTP 200 and returns correct facet results scoped to Tenant A; no waiver is permitted for this scenario because $facet (≤4) is SUPPORTED

#### Scenario: Unique index constraint is enforced by FerretDB (E11000)

- **WHEN** Tenant A's credentials are used to insert a document that violates a unique index constraint via `POST /v1/collections/{name}/documents`
- **THEN** the response is a non-2xx error indicating a duplicate-key violation (E11000), confirming FerretDB enforces unique indexes; this scenario is SUPPORTED and must pass without a waiver

#### Scenario: Sparse and compound indexes are accepted and enforced by FerretDB

- **WHEN** a collection with sparse and compound index definitions is accessed via the document-store API against FerretDB
- **THEN** the response is HTTP 200, confirming all index types are SUPPORTED; no waiver is permitted

#### Scenario: TTL index configuration is accepted by FerretDB

- **WHEN** a collection with a TTL index field is created and documents are inserted via `POST /v1/collections/{name}/documents` against FerretDB
- **THEN** the index creation and insert responses are successful (HTTP 200/201), confirming TTL index configuration is SUPPORTED; background expiry enforcement timing is not asserted in this suite (⚠ not code-verifiable within the validation window)

#### Scenario: Transaction commit returns deterministic CommandNotFound (error 59) against FerretDB

- **WHEN** the transaction operation (snapshot/majority) in `services/adapters/src/mongodb-data-api.mjs` is triggered via the public API against FerretDB v2 and a commit is attempted
- **THEN** FerretDB v2 returns CommandNotFound with error code 59; the validation suite asserts this exact code and records it as an ADR-14-referenced data-integrity finding; no "either succeeds" branch is present

#### Scenario: Transaction abort is a silent no-op — partial writes are NOT rolled back

- **WHEN** a transaction operation writes one or more documents and then abort is called against FerretDB v2
- **THEN** the written documents remain readable after the abort (confirming the abort is a silent no-op); the validation suite asserts this partial-write behaviour is detected and records it as an ADR-14-referenced data-integrity finding, not an unreviewed failure

#### Scenario: CDC change-stream watch returns CommandNotSupported (error 115) against FerretDB

- **WHEN** the validation suite attempts to establish a change-stream listener (mirroring `tests/e2e/realtime/tenant-isolation.test.mjs`) against FerretDB v2
- **THEN** FerretDB v2 returns CommandNotSupported with error code 115; the suite asserts this exact code as the confirmed outcome and records it as an ADR-14-referenced finding with a pointer to `add-ferretdb-realtime-cdc-remediation`; the suite does not count this as an unreviewed failure

#### Scenario: changeStreamPreAndPostImages returns UnknownBsonField (error 40415) against FerretDB

- **WHEN** the validation suite attempts to set `changeStreamPreAndPostImages` on a collection against FerretDB v2
- **THEN** FerretDB v2 returns UnknownBsonField with error code 40415; the suite asserts this exact code as the confirmed outcome and records it as an ADR-14-referenced finding

### Requirement: Isolation gap is probed and recorded — app-layer tenantId filter is the sole enforced boundary

The system SHALL provide a probe that confirms DocumentDB per-database role scoping does NOT enforce cross-tenant denial at the backend layer, and SHALL record (referencing ADR-14) that the app-layer `tenantId` field filter in `services/adapters/src/mongodb-data-api.mjs` is the sole authoritative boundary. Note: `apps/control-plane/src/postgres-applier.mjs` contains no Mongo role, createUser, or per-tenant DocumentDB identity provisioning logic — the go/no-go gate does not assume a backend security boundary exists.

#### Scenario: Backend-layer isolation gap is confirmed and recorded

- **WHEN** the isolation-gap probe connects to the FerretDB/DocumentDB backend using tenant_a credentials and reads from the tenant_b database namespace directly (bypassing the Falcone API layer)
- **THEN** the read succeeds at the backend layer (confirming no per-database role scoping), and the probe records this as a known ADR-14-referenced finding; the suite does not treat this as an unreviewed failure but treats any unexpected denial as a new finding requiring investigation

### Requirement: Validation runner enforces engine-first startup with the pinned version pair

The system SHALL start `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` first and confirm it is healthy before starting `ghcr.io/ferretdb/ferretdb:2.7.0`, and SHALL not connect to either container for testing until both containers report healthy, using the pinned version pair.

#### Scenario: Validation runner waits for engine-first startup before connecting

- **WHEN** the validation runner is invoked
- **THEN** the runner starts and health-checks `postgres-documentdb:17-0.107.0-ferretdb-2.7.0` before starting `ferretdb:2.7.0`, confirms both containers healthy, and only then initiates test connections; failure of either health check blocks the entire suite

### Requirement: Cross-tenant document access is denied by the data API

The system SHALL deny Tenant A access to Tenant B's documents through the document-store API, returning HTTP 403 or HTTP 404, so that per-tenant data isolation enforced by the `tenantId` field in `services/adapters/src/mongodb-data-api.mjs` is confirmed at the API layer post-migration.

#### Scenario: Tenant A is denied when listing Tenant B's documents

- **WHEN** Tenant A's credentials are used to call `GET /v1/collections/{name}/documents` where the collection is scoped to Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no Tenant B documents are returned

#### Scenario: Tenant A is denied when querying Tenant B's collection

- **WHEN** Tenant A's credentials are used to call `POST /v1/collections/{name}/query` targeting a collection owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no Tenant B document data is disclosed

### Requirement: Validation is runnable from a single entrypoint wired into tests/env

The system SHALL provide a single entrypoint script that runs both the document-parity checker and the per-tenant API smoke (including risk-area probes and the cross-tenant negative probe) against the `tests/env/` real-stack harness, honouring the FerretDB connection URI from the environment, and SHALL exit zero only when all checks pass or all failures are explicitly waived per ADR-14, so that the result can gate CI and the rollback-plan go/no-go.

#### Scenario: Entrypoint runs all checks and exits zero on full pass

- **WHEN** the validation entrypoint is invoked with the FerretDB endpoint configured and the migrated data has 100% parity and correct per-tenant API behaviour
- **THEN** the entrypoint exits with code 0 and prints a summary confirming parity-checker pass and per-tenant smoke pass for both tenants, listing any ADR-14 waivers

#### Scenario: Entrypoint exits non-zero and names the failing check

- **WHEN** any check (parity, per-tenant smoke, or cross-tenant denial) fails without a corresponding ADR-14 waiver
- **THEN** the entrypoint exits with a non-zero code and includes the name of the failing check and the relevant details in its output

#### Scenario: Entrypoint emits ADR-14 waiver summary for known FerretDB v2 limitations

- **WHEN** the entrypoint completes and one or more risk-area checks were waived with ADR-14 references
- **THEN** the entrypoint prints a waiver summary listing each waived check, the ADR-14 decision referenced, and the tracking change ID (e.g., `add-ferretdb-realtime-cdc-remediation`), and does not exit non-zero solely due to waived checks

