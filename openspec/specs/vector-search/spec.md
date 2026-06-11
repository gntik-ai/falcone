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

The system SHALL, when a `POST /v1/collections/{name}/search` or insert request
supplies `queryText` (or a text field marked for embedding) instead of a raw vector, call
the tenant-scoped embedding provider configured on the workspace to obtain the
embedding, then proceed with the search or insert using the returned vector. The
embedding dimension returned by the provider MUST match the declared column dimension;
a mismatch SHALL cause the request to fail with HTTP 422.

#### Scenario: Query text is embedded and search proceeds

- **WHEN** a data-access caller submits a KNN search with `queryText: "semantic query"`
  and the workspace has an embedding provider configured
- **THEN** the system calls the provider, obtains a vector of the correct dimension,
  and returns KNN results as if the caller had supplied the vector directly

#### Scenario: Embedding dimension mismatch is rejected

- **WHEN** the embedding provider returns a vector whose length differs from the
  declared column dimension
- **THEN** the system rejects the request with HTTP 422 citing a dimension mismatch,
  and no database query is executed

#### Scenario: Search with queryText fails when no provider is configured

- **WHEN** a data-access caller submits a KNN search with `queryText` but the workspace
  has no embedding provider configured
- **THEN** the system rejects the request with HTTP 422 indicating that in-platform
  embedding requires a configured provider

### Requirement: Embedding provider is tenant-scoped and credentials are stored via secret refs

The system SHALL persist the embedding provider configuration per workspace using the
existing `config.secretRefs` / Vault + External Secrets (ESO) pattern so that provider
API keys are never stored in plaintext and are injected at request time. The provider
SHALL be replaceable (PUT) and removable (DELETE) without affecting previously stored
vectors.

#### Scenario: Provider configured with a secret ref is usable for embedding

- **WHEN** a structural admin configures an embedding provider on a workspace using a
  `secretRef` pointing to a Vault path that resolves to an API key
- **THEN** a subsequent KNN search with `queryText` calls the provider using the
  resolved key and returns results

#### Scenario: Provider from workspace A is not accessible to workspace B

- **WHEN** workspace A configures an embedding provider and workspace B submits a KNN
  search with `queryText`
- **THEN** workspace B's request fails with HTTP 422 (no provider configured) because
  the provider is scoped to workspace A

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

