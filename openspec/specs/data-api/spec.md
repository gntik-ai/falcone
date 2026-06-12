# data-api Specification

## Purpose
TBD - created by archiving change add-postgres-data-crud-execute. Update Purpose after archive.
## Requirements
### Requirement: Row CRUD plans are executed against the workspace database

The system SHALL execute the SQL plan produced by `buildPostgresDataApiPlan` against
the workspace Postgres database, acquiring the connection under the caller's effective
RLS role so that `list`, `get`, `insert`, `update`, and `delete` requests return real
data or effect real mutations.

#### Scenario: Insert then list returns the inserted row

- **WHEN** a caller with `data_access` privilege inserts a row into a workspace table
  via `POST /v1/collections/{name}/documents` and then lists rows via
  `GET /v1/collections/{name}/documents`
- **THEN** the list response contains the row that was inserted and the insert response
  returns the full row with all `RETURNING` columns populated

#### Scenario: Filter and keyset pagination return the correct subset

- **WHEN** a caller requests rows with an `eq` filter on a column and a `page[size]`
  limit via `POST /v1/collections/{name}/query`
- **THEN** the response contains only rows matching the filter, the number of rows does
  not exceed `page[size]`, and a `page.after` cursor is present when more rows exist

### Requirement: Executor enforces the caller's RLS context

The system SHALL acquire the workspace database connection under the caller's effective
RLS role and emit the plan's session settings before executing any SQL, so that
row-level security policies filter results and guard writes without server-side
predicate injection by the BaaS layer.

#### Scenario: Anon-key caller sees only RLS-permitted rows

- **WHEN** a caller authenticated with an anon key issues a `list` request on a table
  that has an RLS policy permitting only rows where `owner_id = auth.uid()`
- **THEN** the response contains only rows whose `owner_id` matches the caller's
  identity and no rows belonging to other identities are included, even if they exist
  in the table

#### Scenario: WITH CHECK blocks a cross-tenant insert

- **WHEN** a caller authenticated as tenant A attempts to insert a row that would fail
  the table's `WITH CHECK` RLS policy (e.g. `tenant_id` does not match the session
  claim)
- **THEN** the insert is rejected with a 403-class response and no row is written to
  the database

### Requirement: Bulk operations execute atomically

The system SHALL execute `bulk_insert`, `bulk_update`, and `bulk_delete` plans as a
single database transaction so that either all rows in the batch are affected or none
are, and partial-batch failures do not leave the table in an inconsistent state.

#### Scenario: Bulk insert persists all rows or none

- **WHEN** a caller submits a bulk insert of N rows and the operation succeeds
- **THEN** all N rows are present in the table and the response lists all N inserted
  row identifiers

### Requirement: RPC calls return the routine result

The system SHALL execute an `rpc` plan against the workspace database and return the
result set produced by the target Postgres function so that callers can invoke
workspace-defined routines through the data API.

#### Scenario: RPC call returns the function result

- **WHEN** a caller invokes a workspace routine via the `rpc` operation with a valid
  argument set
- **THEN** the response contains the value returned by the Postgres function and the
  HTTP status is 200

### Requirement: Driver errors are mapped to sanitized HTTP responses

The system SHALL translate Postgres driver error codes to deterministic HTTP status
codes and return an opaque error reference without exposing internal SQL details, so
that callers receive actionable errors and no schema or query information is leaked.

#### Scenario: Constraint violation returns 409

- **WHEN** an insert or update violates a unique or foreign-key constraint on the
  workspace table
- **THEN** the response status is 409 and the body contains a structured error with
  `code: "CONFLICT"` and an opaque `reference` identifier but no SQL fragment

#### Scenario: Invalid input returns 400

- **WHEN** a caller supplies a value that cannot be cast to the target column type
  and the plan produces a Postgres invalid-input error
- **THEN** the response status is 400 and the body identifies the offending field
  without exposing the internal SQL text

### Requirement: MongoDB document CRUD plans are executed against the workspace database

The system SHALL execute the command plan produced by `buildMongoDataApiPlan` against
the workspace MongoDB via the real `mongodb` driver so that `list`, `get`, `insert`,
`update`, `replace`, and `delete` requests return real data or effect real mutations.

#### Scenario: Insert then list returns the inserted document

- **WHEN** a caller with a valid tenant identity inserts a document into a workspace
  collection via `POST /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents`
  and then lists documents via `GET` on the same path
- **THEN** the list response contains the inserted document and the insert response
  returns the full document including the assigned `_id`

#### Scenario: Get by id returns the document

- **WHEN** a caller requests a specific document via
  `GET /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents/{id}`
- **THEN** the response contains the matching document and `found` is `true`

### Requirement: Tenant isolation is enforced via adapter-injected filter on every operation

The system SHALL inject the verified `tenantId` predicate into every query filter and
onto every inserted document via `applyTenantScopeToFilter`, so that no document
belonging to another tenant can be read, updated, replaced, or deleted, regardless of
the document identifier supplied by the caller.

#### Scenario: List returns only the caller tenant documents

- **WHEN** two tenants each have documents in the same collection and tenant A calls list
- **THEN** the response contains only tenant A documents and no tenant B documents appear,
  even though they share the same database and collection

#### Scenario: Filter stays within tenant scope

- **WHEN** a caller applies a field filter on a list request
- **THEN** the response contains only documents that match both the caller's tenant
  predicate and the supplied field filter

#### Scenario: Get by id with a cross-tenant id returns not-found

- **WHEN** tenant A requests a document whose `_id` belongs to tenant B
- **THEN** `found` is `false` and no document is returned, because the adapter's
  tenant predicate is merged into the `findOne` filter

#### Scenario: Update targeting a cross-tenant document matches nothing

- **WHEN** tenant A sends an update with the `_id` of a document owned by tenant B
- **THEN** `matched` is 0, the document is not modified, and no error is returned

#### Scenario: Delete targeting a cross-tenant document deletes nothing

- **WHEN** tenant A sends a delete with the `_id` of a document owned by tenant B
- **THEN** `deleted` is 0 and the document remains intact

### Requirement: Insert rejects a forged tenant identity

The system SHALL reject any insert payload where the document's `tenantId` field differs
from the verified caller tenant, returning HTTP 403, so that a caller cannot write data
into another tenant's namespace.

#### Scenario: Insert with a forged tenantId is rejected

- **WHEN** a caller authenticated as tenant A submits an insert with `tenantId` set to
  tenant B inside the document payload
- **THEN** the response status is 403, no document is written, and the total document
  count in the collection remains unchanged

### Requirement: Missing tenant identity returns 401

The system SHALL return HTTP 401 for any Mongo data-API request that arrives without a
resolvable tenant identity (no `x-tenant-id` header and no valid API key), so that
unauthenticated callers cannot access any collection.

#### Scenario: Request with no identity is rejected with 401

- **WHEN** a caller sends a list request to a Mongo data endpoint without providing any
  tenant identity (no JWT headers, no API key)
- **THEN** the response status is 401 and no documents are returned

### Requirement: Driver errors are returned as sanitized HTTP responses

The system SHALL catch all `mongodb` driver errors, log the raw error server-side with
an opaque correlation identifier, and return only the HTTP status and a stable error
`code` without exposing driver internals, query filters, or tenant field values to the
caller.

#### Scenario: Unhandled driver error returns 500 with opaque code

- **WHEN** the `mongodb` driver raises an unexpected error during execution of a plan
- **THEN** the response status is 500, the body contains `code: "MONGO_ERROR"`, and no
  driver message, filter text, or tenant data appears in the response

### Requirement: MongoDB executor is disabled when no URI is configured

The system SHALL return HTTP 501 for any Mongo data-API request when neither `MONGO_URI`
nor `MONGO_HOST` is set, so that deployments without a MongoDB instance fail fast rather
than silently.

#### Scenario: Mongo route returns 501 when executor is not configured

- **WHEN** the control-plane starts without `MONGO_URI` or `MONGO_HOST` set and a caller
  requests a Mongo document endpoint
- **THEN** the response status is 501 with `code: "MONGO_DISABLED"`

### Requirement: knn_search operation is added to the data API alongside existing CRUD

The system SHALL add `knn_search` to the set of recognised data API operations
(`services/adapters/src/postgresql-data-api.mjs::POSTGRES_DATA_API_OPERATIONS` and
`POSTGRES_DATA_API_CAPABILITIES`), exposed via `POST /v1/collections/{name}/search` with
`privilege_domain: "data_access"`, following the existing `/v1/collections/{name}/...`
route family convention in `services/gateway-config/public-route-catalog.json`. The KNN
plan builder SHALL reuse the existing `normalizeFilters` logic for the optional
hybrid-search filter (operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `like`,
`ilike`, `between`, `is`, `json_contains`, `json_path_eq` from
`POSTGRES_DATA_FILTER_OPERATORS`) and SHALL render a distance ordering clause `ORDER BY
<column> <operator> $queryVector LIMIT k` for the chosen distance metric. The existing
`normalizeOrder` function (column asc/desc only) is NOT modified; the KNN plan uses a
separate dedicated plan path (`buildPostgresKnnSearchPlan`, dispatched from
`buildPostgresDataApiPlan` for `operation: "knn_search"`).

#### Scenario: KNN search plan is built and executed for a valid request

- **WHEN** a data-access caller submits `POST /v1/collections/{name}/search` with
  `{ "queryVector": [...], "topK": 10, "metric": "cosine" }`
- **THEN** the plan builder emits SQL of the form
  `SELECT … FROM … WHERE <rls_clause> ORDER BY "embedding" <=> $1 LIMIT 10`,
  the executor runs it against the workspace database, and the response body contains
  up to 10 rows each with a `distance` field

#### Scenario: Hybrid KNN search combines distance ordering with a scalar filter

- **WHEN** a data-access caller submits a KNN search with both `queryVector` and
  `filter: [{ "columnName": "category", "operator": "eq", "value": "news" }]`
- **THEN** the SQL plan includes both the RLS clause, the scalar filter predicate, and
  the `ORDER BY distance LIMIT k` clause, returning only rows that pass both filters

#### Scenario: knn_search on a collection without a vector column is rejected

- **WHEN** a data-access caller submits a KNN search on a collection that has no
  column of type `vector`
- **THEN** the system rejects the request with HTTP 422 before executing any SQL,
  with an error identifying the absence of a vector column

#### Scenario: Missing queryVector and queryText is rejected

- **WHEN** a data-access caller submits a KNN search with neither `queryVector` nor
  `queryText`
- **THEN** the system rejects the request with HTTP 422 indicating that one of the
  two fields is required

### Requirement: Distance operator selection maps metric name to pgvector operator

The system SHALL map the `metric` field of a KNN search request to the corresponding
pgvector distance operator: `cosine` to `<=>`, `l2` to `<->`, and `inner_product`
to `<#>`. The default metric, when `metric` is omitted, SHALL be `cosine`.

#### Scenario: Cosine metric maps to <=> operator

- **WHEN** a KNN search request specifies `metric: "cosine"` (or omits `metric`)
- **THEN** the generated SQL ORDER BY clause uses the `<=>` operator

#### Scenario: L2 metric maps to <-> operator

- **WHEN** a KNN search request specifies `metric: "l2"`
- **THEN** the generated SQL ORDER BY clause uses the `<->` operator

#### Scenario: Inner-product metric maps to <#> operator

- **WHEN** a KNN search request specifies `metric: "inner_product"`
- **THEN** the generated SQL ORDER BY clause uses the `<#>` operator

#### Scenario: Unknown metric value is rejected

- **WHEN** a data-access caller submits a KNN search with an unrecognised `metric` value
- **THEN** the system rejects the request with HTTP 422 before issuing any SQL

### Requirement: Row write operations apply write-time auto-embedding when a mapping is configured

The system SHALL augment the `insert`, `bulk_insert`, and `update` paths of `executePostgresData`
(`apps/control-plane/src/runtime/postgres-data-executor.mjs`) with a pre-plan auto-embed hook
that fires before `buildRequest` is called. The hook behaviour:

1. Look up an embedding mapping for `(tenantId, workspaceId, schemaName, tableName)` from the
   injected `mappingStore`. If no mapping is found, proceed without modification.
2. If a mapping is found and the source column is present and non-empty in `params.values`
   (for `insert`) or in the row (for `bulk_insert`) or in `params.changes` (for `update`),
   AND the target column is NOT already present in the payload, call
   `embeddingExecutor.embedForWorkspace(workspaceId, sourceText, { expectedDimension, tenantId })`
   where `expectedDimension` is resolved via `columnVectorDimension(client, schemaName,
   tableName, targetColumn)`.
3. Set the target column in the payload to the resulting vector (formatted as a `[a,b,c]` literal
   string, matching the pgvector binding used at lines 1870-1872 of
   `services/adapters/src/postgresql-data-api.mjs`).
4. If the caller explicitly provides the target vector column, store it as-is (no override).

The hook is only active when both `mappingStore` and `embeddingExecutor` are present in the params.
Existing callers that do not pass these fields receive identical behaviour to the current
implementation.

#### Scenario: Auto-embed insert stores the vector and a subsequent KNN search returns the row

- **WHEN** a mapping is configured for (workspace W, schema S, table T, sourceColumn `body`,
  targetColumn `embedding`) and a data-access caller inserts `{ "body": "semantic test" }`
  with no `embedding` field
- **THEN** the executor generates the embedding, stores the row with `embedding` populated,
  and a subsequent `knn_search` on the same table returns the inserted row with a non-null
  `distance` field

#### Scenario: Bulk insert auto-embeds each row independently

- **WHEN** a mapping is configured and a caller submits a bulk insert of N rows each with the
  source text column set and no target vector column
- **THEN** each row receives its own independently generated embedding and all N rows are written
  atomically; if any embedding call fails the entire batch is rejected and no rows are written

#### Scenario: Update re-embeds only when the source column is in the change set

- **WHEN** a mapping is configured and a caller submits an update whose `changes` include the
  source text column but no target vector column
- **THEN** the executor generates a new embedding for the updated text and includes it in the
  `changes` sent to the plan builder, so the stored vector reflects the new text after the update

#### Scenario: Update that omits the source column does not re-embed

- **WHEN** a mapping is configured and a caller submits an update whose `changes` do NOT include
  the source text column
- **THEN** the executor does NOT call `embedForWorkspace` and the target vector column is left
  unchanged in the database

#### Scenario: Tenant identity is stamped before and independent of the auto-embed hook

- **WHEN** an insert with auto-embedding fires for a table that has a `tenant_id` column
- **THEN** the `tenant_id` (and `workspace_id` if present) are stamped by the `stamp()` function
  as they are today, and the auto-embed hook does not interfere with tenant stamping; both the
  `tenant_id` stamp and the `embedding` vector are present in the inserted row

