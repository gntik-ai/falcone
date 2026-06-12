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

### Requirement: The console provides a vector-search view scoped to the active workspace

The system SHALL provide a dedicated vector-search page (`ConsoleVectorSearchPage`,
route `postgres/vector-search`) within the web console, reachable from a nav entry
"Data: Vector Search" in `ConsoleShellLayout.tsx`, that is scoped to the active
workspace resolved from `useConsoleContext().activeWorkspaceId`, so that workspace users
can access all vector-search operations without leaving the console. The page SHALL
follow the layout and session patterns established by
`apps/web-console/src/pages/ConsolePostgresDataPage.tsx` and its nav entry.

#### Scenario: Vector-search page is accessible from the console navigation

- **WHEN** a console user is authenticated and selects a workspace in the header
  context picker, then clicks the "Data: Vector Search" nav link
- **THEN** the browser navigates to `/console/postgres/vector-search` and the
  `ConsoleVectorSearchPage` renders with the active `workspaceId` in scope,
  displaying the three panels: KNN Search, Vector Index, and Embedding Provider

#### Scenario: Page shows a prompt when no workspace is selected

- **WHEN** a console user navigates to `/console/postgres/vector-search` without a
  workspace selected in the context picker
- **THEN** the page renders an empty-state prompt instructing the user to select a
  workspace before performing vector-search operations

### Requirement: A typed service module wraps the five executor vector-search routes

The system SHALL provide a typed TypeScript service module
(`apps/web-console/src/services/vectorSearchApi.ts`) that delegates all HTTP calls to
`requestConsoleSessionJson` from `@/lib/console-session`, covering the five executor
routes so that `VectorSearchConsole` components have a stable, testable interface
independent of URL construction details:
- KNN search: `POST /v1/postgres/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}/search`
- Vector index create: `POST /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes`
- Vector index delete: `DELETE /v1/postgres/databases/{db}/schemas/{s}/tables/{t}/vector-indexes/{indexName}`
- Embedding provider set: `PUT /v1/workspaces/{w}/embedding-provider`
- Embedding provider remove: `DELETE /v1/workspaces/{w}/embedding-provider`

#### Scenario: Service module is the sole HTTP caller for vector-search operations

- **WHEN** `VectorSearchConsole` or a sub-component needs to call any vector-search
  executor route
- **THEN** all HTTP calls go through `vectorSearchApi.ts` rather than calling
  `requestConsoleSessionJson` inline, so that URL construction and response-type
  assertions are centralised and independently testable

### Requirement: The user can run a KNN similarity search from the console

The system SHALL allow a console user to execute a KNN similarity search from the
KNN Search panel by entering either a query vector (JSON array of numbers) or query
text (in-platform embedding via the configured provider), selecting a distance metric
(`cosine` default, `l2`, `inner_product`) and a top-K value (default 10), and
optionally adding scalar column filters for hybrid search. Results SHALL be displayed
as a ranked table of rows ordered nearest-first, each row including its `distance`
value, so that developers can interactively explore their vector data from the console.

#### Scenario: KNN search with a query vector returns ranked results

- **WHEN** a console user enters a valid JSON array as the query vector, sets top-K
  to 5, selects metric "cosine", and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with the correct `queryVector`,
  `metric`, and `topK` parameters, the response rows are rendered in a table ordered
  by ascending `distance`, and at most 5 rows are displayed

#### Scenario: KNN search with query text triggers in-platform embedding

- **WHEN** a console user enters a text string in the query-text input, leaves the
  query-vector input empty, and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with `queryText` (not `queryVector`),
  and results are displayed if the workspace has a configured embedding provider

#### Scenario: Hybrid search applies scalar filters alongside the vector query

- **WHEN** a console user adds one or more scalar column filters in addition to the
  query vector and submits the KNN search form
- **THEN** `vectorSearchApi.knnSearch` is called with both `queryVector`/`queryText`
  and the `filter` object, and only rows matching the scalar filter appear in the
  result table

### Requirement: The EMBEDDING_PROVIDER_MISSING error is surfaced clearly with a link to provider config

The system SHALL detect the HTTP 422 response with `code: "EMBEDDING_PROVIDER_MISSING"`
returned by the executor when a `queryText` KNN request targets a workspace with no
configured provider, and SHALL display a clear inline error message naming the error
code together with a link to the Embedding Provider panel, so that the user knows how
to resolve the missing-provider state without inspecting raw HTTP responses.

#### Scenario: EMBEDDING_PROVIDER_MISSING error links to provider config

- **WHEN** a console user submits a KNN search using query text and the executor
  returns HTTP 422 with `code: "EMBEDDING_PROVIDER_MISSING"`
- **THEN** the KNN Search panel renders an inline error banner containing the text
  "EMBEDDING_PROVIDER_MISSING" and a link or button that navigates the user to the
  Embedding Provider panel (or scrolls it into view) so they can configure a provider

#### Scenario: Dimension-mismatch error (400/422) is surfaced as an inline banner

- **WHEN** the executor returns HTTP 400 or 422 for a KNN search (e.g. wrong vector
  dimension or missing `vectorColumn`)
- **THEN** the panel displays the `message` field from the error response as an inline
  banner without a stack trace or raw JSON body

### Requirement: The user can create and delete vector indexes from the console

The system SHALL provide a Vector Index panel within `VectorSearchConsole` that allows
a console user to create a vector index on a nominated column by selecting index type
(HNSW default, IVFFlat) and metric (cosine default), or to delete an existing vector
index by name, via calls to `vectorSearchApi.createVectorIndex` and
`vectorSearchApi.deleteVectorIndex` respectively.

#### Scenario: Create an HNSW cosine index via the console

- **WHEN** a console user fills in the db, schema, table, column, leaves index type as
  HNSW and metric as cosine, and confirms the create-index action
- **THEN** `vectorSearchApi.createVectorIndex` is called with `indexType: "hnsw"` and
  `metric: "cosine"`, a success confirmation is shown, and the index name is reflected
  in the UI

#### Scenario: Delete a vector index via the console

- **WHEN** a console user enters an index name and confirms the delete-index action
- **THEN** `vectorSearchApi.deleteVectorIndex` is called with the correct `indexName`,
  and a success confirmation is shown; on failure the `message` field is displayed as
  an inline error banner

#### Scenario: Index management error is surfaced clearly

- **WHEN** a create or delete call returns a 4xx or 5xx response
- **THEN** the Vector Index panel displays the `message` field from the error response
  as an inline error banner without a stack trace or raw JSON body

### Requirement: The user can set and remove the workspace embedding provider from the console

The system SHALL provide an Embedding Provider panel within `VectorSearchConsole` that
allows a console user to configure the workspace embedding provider by entering
`providerType`, `model`, `endpoint` (optional), `dimension` (optional), and `secretRef`
(a secret reference NAME, never a raw API key), or to remove the provider configuration,
via calls to `vectorSearchApi.setEmbeddingProvider` and
`vectorSearchApi.removeEmbeddingProvider`. The UI SHALL only accept a `secretRef` name
for the provider credential, and SHALL never display or accept a raw API key value.

#### Scenario: Set the embedding provider with a secretRef

- **WHEN** a console user enters a `providerType`, `model`, and `secretRef` name in the
  Embedding Provider panel and submits the form
- **THEN** `vectorSearchApi.setEmbeddingProvider` is called with a body containing
  `providerType`, `model`, and `secretRef` but no raw credential value, and a success
  confirmation is displayed

#### Scenario: Remove the embedding provider

- **WHEN** a console user clicks the remove-provider action in the Embedding Provider
  panel and confirms the destructive action
- **THEN** `vectorSearchApi.removeEmbeddingProvider` is called and a success
  confirmation is shown; the panel reverts to the not-configured state

#### Scenario: Raw API key is never accepted or displayed in the provider form

- **WHEN** the Embedding Provider panel renders the provider configuration form
- **THEN** the form contains only a `secretRef` field for credentials (no "API key"
  or "password" free-text input), and the rendered HTML contains no input of type
  `password` or field labelled with "key" or "secret value" that would accept a raw key

#### Scenario: Provider configuration error is surfaced clearly

- **WHEN** the set- or remove-provider call returns a 4xx or 5xx response
- **THEN** the Embedding Provider panel displays the `message` field from the error
  response as an inline error banner without a stack trace or raw body

