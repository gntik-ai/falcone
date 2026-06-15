## ADDED Requirements

### Requirement: Data API routes return correct tenant-scoped results against FerretDB/DocumentDB backend

The system SHALL return tenant-scoped results from the document-store routes (`POST /v1/collections/{name}/documents`, `GET /v1/collections/{name}/documents`, `POST /v1/collections/{name}/query`, `GET /v1/collections/{name}/search`) regardless of whether the underlying document-store backend is MongoDB or FerretDB/DocumentDB (`ghcr.io/ferretdb/ferretdb:2.7.0`), as configured via environment variable and executed by `apps/control-plane/src/runtime/mongo-data-executor.mjs` using plans from `services/adapters/src/mongodb-data-api.mjs`.

#### Scenario: Insert then list returns the inserted document scoped to the requesting tenant

- **WHEN** an authenticated request for Tenant A calls `POST /v1/collections/{name}/documents` to insert a document and then `GET /v1/collections/{name}/documents` with the FerretDB endpoint configured
- **THEN** the list response contains the inserted document and only documents belonging to Tenant A; no documents from other tenants are included

#### Scenario: Query with filter returns only matching documents for the requesting tenant

- **WHEN** an authenticated request for Tenant B calls `POST /v1/collections/{name}/query` with an equality filter on a field
- **THEN** the response contains only documents matching the filter that are scoped to Tenant B; documents belonging to other tenants are not returned even if they match the filter

### Requirement: Data API enforces cross-tenant document denial at the route level

The system SHALL return HTTP 403 or HTTP 404 on any document-store API request where the authenticated tenant does not own the addressed collection, so that tenant isolation enforced by the `tenantId` field in `services/adapters/src/mongodb-data-api.mjs` is preserved at the API layer independently of the backend implementation.

#### Scenario: Cross-tenant document list access is denied

- **WHEN** an authenticated request for Tenant A calls `GET /v1/collections/{name}/documents` where the collection is scoped to Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and the response body does not include any documents from Tenant B's collection

#### Scenario: Cross-tenant query access is denied

- **WHEN** an authenticated request for Tenant A calls `POST /v1/collections/{name}/query` targeting a collection owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no document data from Tenant B's collection is disclosed in the response body

### Requirement: Data API supported aggregation operators MUST return correct results against FerretDB; adapter-capped operators are not waivable

The system SHALL return HTTP 200 with correct tenant-scoped results when `$lookup` (same-namespace, at most one join), `$facet` (at most four sub-pipelines), and `$group` aggregation operators are issued via `POST /v1/collections/{name}/query` against the FerretDB/DocumentDB backend, as implemented in `services/adapters/src/mongodb-data-api.mjs`. The ≤1 join and ≤4 sub-pipeline caps are enforced by the adapter allowlist, not by FerretDB; a waiver path for these operators is not permitted because it would mask regressions. Cross-database `$lookup` is rejected by FerretDB with error code Location40321 and the system SHALL record this exact code.

#### Scenario: $group aggregation returns correct results against FerretDB

- **WHEN** an authenticated request calls `POST /v1/collections/{name}/query` with a `$group` pipeline stage against the FerretDB backend
- **THEN** the response is HTTP 200 with correct grouped results scoped to the requesting tenant

#### Scenario: Same-namespace $lookup with one join returns correct results against FerretDB

- **WHEN** an authenticated request calls `POST /v1/collections/{name}/query` with a `$lookup` stage joining at most one collection within the same database namespace against the FerretDB backend
- **THEN** the response is HTTP 200 with correct joined results; no waiver is permitted for this scenario

#### Scenario: $facet with four sub-pipelines returns correct results against FerretDB

- **WHEN** an authenticated request calls `POST /v1/collections/{name}/query` with a `$facet` stage containing at most four sub-pipelines against the FerretDB backend
- **THEN** the response is HTTP 200 with correct facet results; no waiver is permitted for this scenario

#### Scenario: Cross-database $lookup is rejected with Location40321

- **WHEN** an authenticated request calls `POST /v1/collections/{name}/query` with a `$lookup` stage referencing a collection in a different database namespace against the FerretDB backend
- **THEN** FerretDB rejects the request with error code Location40321 and the validation suite records this exact code as the expected and confirmed outcome

### Requirement: Data API isolation gap is recorded — app-layer tenantId filter is the sole enforced boundary

The system SHALL include a probe that confirms the app-layer `tenantId` field filter in `services/adapters/src/mongodb-data-api.mjs` is the sole enforced boundary for cross-tenant document isolation, and SHALL record (referencing ADR-14) that DocumentDB per-database role scoping does NOT enforce cross-tenant denial at the backend layer. The go/no-go gate for this change must not assume a backend security boundary exists. Note: `apps/control-plane/src/postgres-applier.mjs` manages schemas/tables/views/extensions/grants only and contains no Mongo role, createUser, or per-tenant DocumentDB identity provisioning logic.

#### Scenario: Backend-layer isolation gap is detected and recorded against ADR-14

- **WHEN** the isolation-gap probe connects to the FerretDB/DocumentDB backend using tenant_a credentials and attempts to read documents from the tenant_b database namespace directly (bypassing the Falcone API layer)
- **THEN** the read succeeds at the backend layer (confirming no per-database role scoping is enforced), and the probe records this finding with an explicit ADR-14 reference and confirms that the Falcone API layer's tenantId filter is the sole enforced boundary
