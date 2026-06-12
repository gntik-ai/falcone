# vector-search Specification

## Purpose
TBD - created by archiving change add-vector-search. Update Purpose after archive.
## Requirements
### Requirement: pgvector extension is enabled only for dedicated-DB tenants

The system SHALL enable the `vector` pgvector extension exclusively for tenants whose
data plane uses `database_per_tenant` placement, building on the existing
`POSTGRES_EXTENSION_CATALOG` entry at
`services/adapters/src/postgresql-governance-admin.mjs::POSTGRES_EXTENSION_CATALOG`
(lines 36-41), and SHALL reject enablement requests for shared or schema-per-tenant
tenants with a 422 validation error.

#### Scenario: Extension enablement accepted for dedicated-DB tenant

- **WHEN** a workspace with `placementMode: "database_per_tenant"` submits a governance
  request to enable the `vector` extension
- **THEN** the system executes `CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA
  "public"` in the tenant's dedicated database and returns a success response confirming
  the extension is active

#### Scenario: Extension enablement rejected for schema-per-tenant workspace

- **WHEN** a workspace with `placementMode: "schema_per_tenant"` submits a governance
  request to enable the `vector` extension
- **THEN** the system rejects the request with HTTP 422 and an error message indicating
  that the `vector` extension is not available for the `schema_per_tenant` placement mode,
  and no SQL is executed against any database

### Requirement: Vector field type is declared with a fixed dimension

The system SHALL accept a field definition of type `vector` with a required integer
`dimension` attribute (range 1-16000) when creating or altering a collection schema, and
SHALL reject inserts or updates whose supplied vector value has a length that differs from
the declared dimension.

#### Scenario: Vector column is created with the correct pgvector type

- **WHEN** a structural admin submits a column definition with `dataType: "vector"` and
  `dimension: 1536` on a table in a `database_per_tenant` workspace
- **THEN** the DDL executor issues `ALTER TABLE … ADD COLUMN "embedding" vector(1536)`
  and the column appears in `information_schema.columns` with `data_type` reflecting
  the pgvector type

#### Scenario: Insert with wrong vector length is rejected

- **WHEN** a data-access caller inserts a document into a collection with a `vector(1536)`
  column but supplies a vector of length 512
- **THEN** Postgres raises a dimension-mismatch error, the executor maps it to HTTP 400,
  and no row is written

#### Scenario: Missing dimension attribute is rejected at schema-definition time

- **WHEN** a structural admin submits a column definition with `dataType: "vector"` but
  omits the `dimension` attribute
- **THEN** the system rejects the request with HTTP 422 before issuing any DDL, with an
  error identifying `dimension` as a required attribute for vector columns

### Requirement: Vector index is created with HNSW as the default and configurable metric

The system SHALL create a vector index on a nominated column via the structural admin
surface, defaulting to HNSW index type and cosine distance metric
(`vector_cosine_ops`), with the option to specify L2 (`vector_l2_ops`) or inner
product (`vector_ip_ops`) operators. The index SHALL be recorded in the workspace
schema catalog.

#### Scenario: Default HNSW cosine index is created

- **WHEN** a structural admin submits a vector index creation request specifying only
  the target column, with no `indexType` or `metric` override
- **THEN** the DDL executor issues
  `CREATE INDEX … ON … USING hnsw ("embedding" vector_cosine_ops)` and the index
  appears in `pg_indexes` for that table

#### Scenario: IVFFlat L2 index is created when explicitly requested

- **WHEN** a structural admin submits a vector index creation request with
  `indexType: "ivfflat"` and `metric: "l2"`
- **THEN** the DDL executor issues
  `CREATE INDEX … ON … USING ivfflat ("embedding" vector_l2_ops)` and the index
  appears in `pg_indexes` for that table

#### Scenario: Unsupported metric is rejected

- **WHEN** a structural admin submits a vector index creation request with an
  unrecognised `metric` value (e.g. `"hamming"`)
- **THEN** the system rejects the request with HTTP 422 before issuing any DDL

### Requirement: KNN search returns top-k results ordered by distance within tenant scope

The system SHALL execute a KNN (k-nearest-neighbour) similarity search against a
collection's vector column, accepting either a pre-computed query vector or query text
(when an embedding provider is configured), returning at most `k` results ordered by
the chosen distance metric (cosine, L2, or inner product), and SHALL scope the search
to the authenticated tenant via RLS so that results from other tenants are never
returned even if their vectors are numerically closer.

#### Scenario: KNN search with a query vector returns top-k results

- **WHEN** a data-access caller submits `POST /v1/collections/{name}/search` with a
  `queryVector` of correct dimension and `topK: 5` on a collection with a `vector`
  column
- **THEN** the response contains at most 5 rows ordered by ascending distance to the
  query vector, each row including a `distance` field, and all rows belong to the
  authenticated tenant

#### Scenario: Hybrid KNN search applies scalar filter before ranking

- **WHEN** a data-access caller submits a KNN search with both `queryVector` and a
  `filter` using an existing operator (e.g. `eq` on a scalar column)
- **THEN** the response contains only rows that pass the filter, ordered by distance,
  with at most `topK` results

#### Scenario: KNN search respects topK limit

- **WHEN** a data-access caller requests `topK: 3` and the collection contains 100
  matching rows
- **THEN** the response contains exactly 3 rows

### Requirement: In-platform embedding generation translates query text to a vector

The running control-plane SHALL construct an `embeddingExecutor` (via `createEmbeddingExecutor`
from `apps/control-plane/src/runtime/embedding-executor.mjs`) backed by a Postgres-persistent
`createEmbeddingProviderStore({ pool })` and SHALL pass it as `embeddingExecutor` to
`createControlPlaneServer`, so that the `queryText` KNN path (the `POST .../search` route in
`apps/control-plane/src/runtime/server.mjs`) and the
`PUT/DELETE /v1/workspaces/{id}/embedding-provider` routes are operational
rather than returning HTTP 501 `EMBEDDING_DISABLED`.

#### Scenario: queryText KNN search succeeds when a provider is configured

- **WHEN** a structural admin has configured an embedding provider via
  `PUT /v1/workspaces/{id}/embedding-provider` and a data-access caller submits a
  `POST /v1/.../search` with `queryText`
- **THEN** the system SHALL return KNN results (HTTP 200) rather than HTTP 501
  `EMBEDDING_DISABLED`, because the `embeddingExecutor` is wired in the running control-plane

#### Scenario: Embedding provider routes return 422 not 501 when no provider is configured

- **WHEN** the control-plane starts with a Postgres-backed `embeddingExecutor` wired and a
  `queryText` KNN request targets a workspace with no configured provider
- **THEN** the system MUST return HTTP 422 with `code: "EMBEDDING_PROVIDER_MISSING"` (the
  `createEmbeddingExecutor::resolveBackend` error in `embedding-executor.mjs`) rather
  than HTTP 501, confirming the executor is active

### Requirement: Embedding provider is tenant-scoped and credentials are stored via secret refs

The system SHALL scope reads and writes of a workspace's embedding-provider record to the
`(tenant_id, workspace_id)` pair so that a write for workspace W under tenant A cannot
overwrite or shadow the provider record of workspace W under tenant B, consistent with the
`workspace_api_keys` scoping pattern in
`apps/control-plane/src/runtime/api-keys.mjs` (lines 36-48).

#### Scenario: Embedding provider write is scoped to tenant and workspace

- **WHEN** tenant A configures an embedding provider on workspace W and tenant B subsequently
  configures a different provider on a workspace with the same `workspaceId` value W
- **THEN** each tenant's provider record SHALL be stored independently keyed by
  `(tenant_id, workspace_id)`; a `queryText` KNN search by tenant A MUST use tenant A's
  provider and tenant B MUST use tenant B's provider, with no cross-tenant leakage

### Requirement: Cross-tenant KNN probe never returns another tenant's vectors

The system SHALL ensure that a KNN search issued by tenant A NEVER returns rows owned
by tenant B, even if tenant B's vectors are numerically closer to the query, by executing
the KNN query under the non-BYPASSRLS application role and enforcing the RLS policy
that binds result rows to the session's `app.current_tenant_id`.

#### Scenario: Cross-tenant KNN probe returns zero tenant-B rows

- **WHEN** tenant A and tenant B both have vectors in the same collection schema, and
  tenant A issues a KNN search whose query vector is nearest to a tenant B vector
- **THEN** the response contains only tenant A vectors; no tenant B vector appears in
  the result set, and the `distance` field reflects distances only among tenant A rows

#### Scenario: KNN under application role never bypasses RLS

- **WHEN** the KNN executor acquires a database connection using the non-BYPASSRLS
  `falcone_app` role and issues an ORDER BY distance query on the vector column
- **THEN** the RLS policy filters the candidate set before distance ranking, so tenant B
  rows are excluded from the ANN index scan result

### Requirement: Vector quota dimensions are enforced per tenant

The system SHALL track and enforce per-tenant quota dimensions for vector usage:
`vector_row_count` (total indexed vectors), `max_vector_dimension` (maximum allowed
dimension), and `vector_index_memory_mb` (estimated HNSW/IVFFlat index memory). A
tenant that exceeds any of these limits SHALL receive HTTP 429 on inserts and HTTP 422
on index creation.

#### Scenario: Vector insert is rejected when vector_row_count quota is exceeded

- **WHEN** a tenant has reached its `vector_row_count` quota limit and attempts to
  insert a new row into a collection with a vector column
- **THEN** the system rejects the insert with HTTP 429 and an error identifying
  `vector_row_count` as the exceeded dimension

#### Scenario: Vector index creation is rejected when dimension exceeds max_vector_dimension

- **WHEN** a structural admin attempts to declare a vector column with `dimension`
  greater than the workspace's `max_vector_dimension` quota value
- **THEN** the system rejects the DDL request with HTTP 422 before issuing any SQL

### Requirement: In-platform embedding generation covers both query time and write time

The system SHALL invoke `embeddingExecutor.embedForWorkspace` not only on the KNN `queryText`
read path (the existing `POST .../search` hook in
`apps/control-plane/src/runtime/postgres-data-executor.mjs` lines 175-181), but also at write
time for `insert`, `bulk_insert`, and `update` operations when a per-collection embedding mapping
is configured, so that applications can store plain text and receive a populated `vector(N)` column
without computing embeddings client-side.

The write-time hook mirrors the read-time pattern exactly: it calls
`columnVectorDimension(client, schemaName, tableName, targetColumn)` to obtain the declared
dimension N, then calls
`embeddingExecutor.embedForWorkspace(workspaceId, text, { expectedDimension: N, tenantId })`.
An explicitly provided target vector in the payload is respected and the hook does NOT override it.

#### Scenario: Write-time embedding populates the vector column on insert

- **WHEN** a structural admin has configured an embedding mapping (source column `body`, target
  column `embedding`) on a collection that has a `vector(1536)` column, and a data-access caller
  inserts a row with `{ "body": "hello world" }` and no `embedding` field
- **THEN** the system generates the embedding in-platform via `embedForWorkspace`, sets the
  `embedding` column to the resulting vector, stores the row, and the subsequent KNN search on
  `embedding` returns the inserted row

#### Scenario: Explicit target vector is preserved without re-embedding

- **WHEN** a mapping is configured and a caller inserts a row with both the source text column
  and an explicit `embedding` vector value
- **THEN** the system stores the explicitly provided vector as-is and does NOT call
  `embedForWorkspace` for that row

#### Scenario: Write-time embedding dimension mismatch is rejected

- **WHEN** a mapping is configured and the embedding provider returns a vector whose length
  differs from the declared dimension of the target `vector(N)` column
- **THEN** the write is rejected with HTTP 422 and `code: "EMBEDDING_DIMENSION_MISMATCH"`,
  and no row is written to the database

#### Scenario: Write blocked with clear error when no provider is configured

- **WHEN** an embedding mapping is configured for a collection but no embedding provider has
  been registered for the workspace, and a caller inserts a row with the source text column
- **THEN** the write is rejected with HTTP 422 and `code: "EMBEDDING_PROVIDER_MISSING"`,
  and no row is written

### Requirement: Per-collection embedding mapping is operator-configured, tenant-scoped, and durable

The system SHALL persist a per-collection embedding mapping keyed by
`(tenant_id, workspace_id, schema_name, table_name, target_column)` in a
`workspace_embedding_mappings` table on the metadata database, mirroring the
`workspace_embedding_providers` pattern from `add-embedding-provider-persistence`
(`apps/control-plane/src/runtime/embedding-executor.mjs::createEmbeddingProviderStore`).
An in-memory fallback (no-pool construction) SHALL be preserved as the test seam.

The operator configures the mapping via `PUT` on the table-scoped mapping route; deletion is
via `DELETE` on the same resource; retrieval is via `GET`. All routes carry
`privilege_domain: "structural_admin"` consistent with the embedding-provider routes in
`services/gateway-config/public-route-catalog.json` (lines 147-154).

#### Scenario: Mapping write is scoped to tenant and workspace

- **WHEN** tenant A configures a mapping on workspace W, schema S, table T and tenant B
  configures a different mapping on a workspace with the same `workspaceId` value W
- **THEN** each tenant's mapping record is stored independently keyed by
  `(tenant_id, workspace_id, schema_name, table_name, target_column)`; write-time embedding
  for tenant A uses tenant A's mapping and provider; no cross-tenant leakage occurs

#### Scenario: Mapping survives restart and is visible to all replicas

- **WHEN** an operator configures an embedding mapping via the API on one control-plane replica
  and the process is restarted (or a second replica is queried)
- **THEN** the mapping record is present because it is persisted in `workspace_embedding_mappings`
  on the shared metadata pool, not held in-memory

### Requirement: Cross-tenant write-time probe never applies another tenant's mapping

The system SHALL ensure that the write-path auto-embed hook resolves the mapping by
`(tenant_id, workspace_id, schema_name, table_name, target_column)` using the verified
identity's `tenantId`, so that a write by tenant A never triggers an embedding derived from
tenant B's mapping or provider configuration.

#### Scenario: Cross-tenant write probe does not apply another tenant's mapping

- **WHEN** tenant A has an embedding mapping on workspace W / table T and tenant B submits
  an insert into a workspace and table with the same identifiers but under tenant B's identity
- **THEN** tenant B's insert does NOT auto-embed via tenant A's mapping; if tenant B has no
  mapping configured the insert proceeds without auto-embedding

