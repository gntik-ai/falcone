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
the workspace MongoDB-compatible backend (FerretDB gateway, `ghcr.io/ferretdb/ferretdb:2.7.0`
backed by DocumentDB engine `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
via the real `mongodb` driver so that `list`, `get`, `insert`, `update`, `replace`, and
`delete` requests return real data or effect real mutations. The `MONGO_URI` environment
variable (resolved as `mongoUri` in `apps/control-plane/src/runtime/main.mjs`) SHALL point
at the FerretDB Service; the tenant-facing `/v1/collections/*` request and response shapes
are UNCHANGED.

#### Scenario: Insert then list returns the inserted document against FerretDB

- **WHEN** a caller with a valid tenant identity inserts a document into a workspace
  collection via `POST /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents`
  and then lists documents via `GET` on the same path, with `MONGO_URI` pointing at a
  FerretDB gateway
- **THEN** the list response contains the inserted document and the insert response
  returns the full document including the assigned `_id`, with identical shapes to the
  MongoDB 7 behavior

#### Scenario: Get by id returns the document from FerretDB

- **WHEN** a caller requests a specific document via
  `GET /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents/{id}` against
  a FerretDB-backed executor
- **THEN** the response contains the matching document and `found` is `true`

### Requirement: Tenant isolation is enforced via adapter-injected filter on every operation

The system SHALL inject the verified `tenantId` predicate into every query filter and
onto every inserted document via `applyTenantScopeToFilter` and `injectTenantIntoDocument`
in `services/adapters/src/mongodb-data-api.mjs`, so that no document belonging to another
tenant can be read, updated, replaced, or deleted, regardless of the document identifier
supplied by the caller. This injection is the **authoritative, primary** tenant isolation
boundary. Per-tenant DocumentDB database/role credentials (introduced in
`add-ferretdb-tenant-isolation-credentials`) are complementary defense-in-depth and do NOT
substitute for adapter-layer injection.

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

The system SHALL catch all `mongodb` driver errors raised by the FerretDB gateway, log the
raw error server-side with an opaque correlation identifier, and return only the HTTP status
and a stable error `code` without exposing driver internals, query filters, or tenant field
values to the caller. FerretDB-specific wire errors SHALL be normalized to the same stable
codes as MongoDB driver errors.

#### Scenario: Unhandled driver error returns 500 with opaque code

- **WHEN** the `mongodb` driver raises an unexpected error during execution of a plan
  against the FerretDB gateway
- **THEN** the response status is 500, the body contains `code: "MONGO_ERROR"`, and no
  driver message, filter text, or tenant data appears in the response

### Requirement: MongoDB executor is disabled when no URI is configured

The system SHALL return HTTP 501 for any Mongo data-API request when neither `MONGO_URI`
nor `MONGO_HOST` is set, so that deployments without a FerretDB (or MongoDB-compatible)
instance fail fast rather than silently.

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

### Requirement: FerretDB migration decision is recorded as ADR-14

The system SHALL have ADR-14 appended to `docs-site/architecture/adrs.md` in the
established format (`## ADR-14 — title`, Decision / Why / Evidence / Risks sections)
documenting the selection of FerretDB 2.7.0 + DocumentDB 0.107 (Apache-2.0, LF
governance) as the replacement document store, and the rejection of Percona Server
(SSPL), native-JSONB (not MongoDB-wire-compatible), ArangoDB (BSL licence), RavenDB
(AGPL), and Couchbase (source-available), so that the document-store migration rationale
is permanently recorded and auditable.

#### Scenario: ADR-14 exists in the established format with all rejected alternatives

- **WHEN** a reviewer reads `docs-site/architecture/adrs.md`
- **THEN** an entry `## ADR-14` is present with non-empty Decision, Why, Evidence, and
  Risks sub-sections, and all five rejected alternatives (Percona Server, native-JSONB,
  ArangoDB, RavenDB, Couchbase) are each listed with an explicit rejection rationale

### Requirement: Compatibility matrix is produced and pinned to the version pair

The system SHALL produce a per-feature compatibility matrix pinned to
`ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`,
classifying each of the following as SUPPORTED, PARTIAL, or UNSUPPORTED with evidence
from the running instance: every aggregation stage allowed or blocked by
`services/adapters/src/mongodb-data-api.mjs` (`$match`, `$project`, `$sort`, `$limit`,
`$skip`, `$group`, `$unwind`, `$lookup` <=1, `$count`, `$facet` <=4, `$addFields`,
`$set`, `$unset`, `$replaceRoot`, `$replaceWith`, `$out`, `$merge`, `$geoNear`); every
index type (single-field, compound, unique, sparse, TTL); multi-document transactions
(`startTransaction`, `commitTransaction`, `abortTransaction`); and change streams
(`collection.watch()`, `changeStreamPreAndPostImages`) — so that downstream implementation
changes have a concrete, version-pinned compatibility baseline grounded in the real
FerretDB/DocumentDB instance.

#### Scenario: Matrix covers all required features with a version pin

- **WHEN** the spike findings are reviewed
- **THEN** the matrix lists every aggregation stage, index type, transaction operation,
  and change-stream operation enumerated in the requirement, each entry carries a
  SUPPORTED / PARTIAL / UNSUPPORTED classification with evidence from the running
  FerretDB 2.7 / DocumentDB 0.107 instance, and the version pair under test is stated
  explicitly

#### Scenario: Allowed aggregation stages are verified against the live instance

- **WHEN** each stage allowed by `services/adapters/src/mongodb-data-api.mjs` is executed
  against FerretDB 2.7 / DocumentDB 0.107
- **THEN** every stage receives a SUPPORTED / PARTIAL / UNSUPPORTED classification, and
  any PARTIAL entry records the exact deviation from MongoDB 6.0+ semantics observed in
  the response

#### Scenario: Blocked aggregation stages return an error on FerretDB

- **WHEN** `$out`, `$merge`, or `$geoNear` is submitted to FerretDB 2.7
- **THEN** the matrix records the stage as UNSUPPORTED and captures the wire error code
  returned by FerretDB

### Requirement: Change-stream gap is explicitly classified and resolved to a remediation path

The system SHALL classify change streams (`collection.watch()` with `$match` on
`fullDocument.tenantId` as used in `apps/control-plane/src/runtime/realtime-executor.mjs`,
and `ChangeStreamWatcher.mjs`) as SUPPORTED, PARTIAL, or UNSUPPORTED against FerretDB
2.7.0 / DocumentDB 0.107.0, and SHALL resolve the gap to a concrete remediation path
(re-architect with Postgres logical replication / shim / drop) with a downstream owner
assigned for each affected subsystem — so that the realtime-executor and CDC bridge
children cannot proceed without a clear migration path.

#### Scenario: Change-stream classification is recorded with wire evidence

- **WHEN** `collection.watch()` with the `$match` pipeline `{fullDocument.tenantId: <id>}`
  is called against FerretDB 2.7
- **THEN** the matrix records the outcome (SUPPORTED / PARTIAL / UNSUPPORTED) with the
  wire response or error code observed

#### Scenario: Pre-image enablement is classified

- **WHEN** `db.command({collMod, changeStreamPreAndPostImages:{enabled:true}})` is called
  against FerretDB 2.7 as used by `realtime-executor.mjs`
- **THEN** the matrix records the outcome (SUPPORTED / PARTIAL / UNSUPPORTED) with the
  wire response observed

#### Scenario: Each change-stream gap has a remediation path and owner

- **WHEN** the spike findings are reviewed
- **THEN** the change-stream gap for `realtime-executor.mjs` and the change-stream gap
  for `ChangeStreamWatcher.mjs` each have an assigned remediation path (re-architect /
  shim / drop) and an identified downstream owner; no gap is left unresolved

### Requirement: Multi-document-transaction gap is explicitly classified and resolved

The system SHALL classify multi-document transactions (`startTransaction`,
`commitTransaction`, `abortTransaction` as declared in `services/adapters/src/mongodb-data-api.mjs`)
as SUPPORTED, PARTIAL, or UNSUPPORTED against FerretDB 2.7.0 / DocumentDB 0.107.0, and
SHALL resolve the gap to a remediation path (shim to single-operation semantics / drop)
with a one-sentence rationale — so that the data-api migration child has an unambiguous
implementation directive.

#### Scenario: Transaction commands are classified with wire evidence

- **WHEN** `startTransaction`, `commitTransaction`, and `abortTransaction` are each
  submitted via the MongoDB wire protocol to FerretDB 2.7
- **THEN** the matrix records each command as SUPPORTED / PARTIAL / UNSUPPORTED with
  the wire response or error code observed

#### Scenario: Transaction gap has a remediation path

- **WHEN** `commitTransaction` or `abortTransaction` is classified as PARTIAL or
  UNSUPPORTED
- **THEN** the spike finding assigns a remediation path (shim to single-op / drop) with
  a one-sentence rationale, and no PARTIAL or UNSUPPORTED transaction entry is left
  without a recommendation

### Requirement: Every non-SUPPORTED matrix entry has a use/shim/drop/re-architect recommendation

The system SHALL resolve every PARTIAL or UNSUPPORTED entry in the FerretDB compatibility
matrix to one of: use (FerretDB native equivalent works with a configuration change),
shim (thin adaptation layer in `services/adapters/src/mongodb-data-api.mjs` or the
executor), drop (feature removed from Falcone's data-api capability), or re-architect
(structural change required — reserved for change streams) — so that the deployment,
per-tenant-provisioning, realtime-executor, and CDC-bridge downstream changes have
unambiguous guidance.

#### Scenario: Every non-SUPPORTED entry has a recommendation

- **WHEN** the spike findings are reviewed
- **THEN** no PARTIAL or UNSUPPORTED entry in the matrix is left without a
  use / shim / drop / re-architect recommendation and a brief rationale

### Requirement: Per-tenant DocumentDB database/role/auth mapping is resolved

The system SHALL resolve, via a spike against the running FerretDB 2.7 / DocumentDB
0.107 instance, how a FerretDB "database" maps to an isolated per-tenant backend given
the decision to use real per-tenant DocumentDB databases and Postgres roles — pinning
the database naming convention, role creation and grant pattern, and authentication
credential injection — so that the per-tenant provisioning downstream child has a
concrete, tested mapping to implement.

#### Scenario: Per-tenant database isolation is confirmed

- **WHEN** two test tenants each have a dedicated DocumentDB database on the same engine
  instance
- **THEN** a cross-database query attempted from tenant A's role is rejected, confirming
  database-level isolation

#### Scenario: FerretDB gateway authenticates with a per-tenant Postgres role

- **WHEN** a per-tenant Postgres role with the minimum required privileges is created
  on the DocumentDB engine
- **THEN** the FerretDB gateway authenticates using that role's credentials and the
  spike finding records the exact grant statements required

#### Scenario: Tenancy mapping is compatible with the existing postgres-applier model

- **WHEN** the per-tenant database/role creation pattern is reviewed against
  `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`
- **THEN** the spike finding records whether the existing applier model can be extended
  to cover DocumentDB provisioning, or identifies the DDL gaps that require a new applier

### Requirement: Colocated-vs-dedicated Postgres decision is recorded

The system SHALL record in ADR-14 whether DocumentDB will run on Falcone's existing
in-chart Postgres instance (colocated) or a dedicated Postgres instance, factoring
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` compatibility with
existing extensions and resource isolation requirements, so that the deployment child
has an authoritative infrastructure decision to implement.

#### Scenario: shared_preload_libraries compatibility is verified

- **WHEN** the DocumentDB extension `pg_documentdb_core,pg_documentdb` is loaded
  alongside `pg_cron` on the same Postgres 17 instance used by the spike
- **THEN** the spike finding records whether the combination succeeds without conflict,
  and the colocated-vs-dedicated decision is recorded with a rationale in ADR-14

#### Scenario: Colocated DocumentDB coexists with schema-per-tenant relational schemas

- **WHEN** DocumentDB extensions are enabled on a Postgres instance that also hosts
  Falcone's schema-per-tenant relational schemas and the `falcone_app` non-BYPASSRLS role
- **THEN** the spike finding records whether coexistence is clean (no DDL conflicts, no
  RLS bypass, no extension interference), or documents the exact conflict and recommends
  dedicated Postgres

### Requirement: Version pair and upgrade order are documented

The system SHALL document the pinned version pair
(`ghcr.io/ferretdb/ferretdb:2.7.0` / `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
and the required upgrade order (DocumentDB engine first, then FerretDB gateway) in
ADR-14's Evidence section, so that all downstream children have an unambiguous version
anchor and operators have a safe upgrade sequence.

#### Scenario: ADR-14 Evidence section contains the pinned version pair and upgrade order

- **WHEN** a reviewer reads the Evidence section of ADR-14 in `docs-site/architecture/adrs.md`
- **THEN** the exact image tags for both `ferretdb` and `postgres-documentdb` are stated,
  and the upgrade order (engine first, gateway second) is explicitly documented with a
  one-sentence rationale

### Requirement: DocumentDB engine deploys as a dedicated Postgres StatefulSet via chart toggle

The system SHALL deploy the DocumentDB engine
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
PostgreSQL 17.6) as a dedicated Postgres StatefulSet in the umbrella Helm chart,
controlled by a `documentdb.enabled` boolean value, so that the DocumentDB engine is
isolated from the existing relational Postgres instance (`postgresql` StatefulSet,
`docker.io/bitnami/postgresql:17.2.0`) — which does not bundle `pg_documentdb` — and
the `shared_preload_libraries` SERVER-START GUC required by DocumentDB is applied only
to the dedicated instance without restarting or modifying the relational Postgres tier.

#### Scenario: DocumentDB engine deploys when enabled

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** a dedicated DocumentDB StatefulSet Pod reaches the Ready state, the pod runs
  image `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`, and the
  existing `postgresql` StatefulSet continues to serve relational data unmodified

#### Scenario: DocumentDB engine absent when disabled

- **WHEN** the umbrella chart is installed without overriding `documentdb.enabled`
- **THEN** no DocumentDB StatefulSet, PVC, Service, ConfigMap, or init Job is created
  and the existing MongoDB and relational Postgres StatefulSets are unaffected

### Requirement: shared_preload_libraries and cron.database_name applied via startup-time ConfigMap and survive restart

The system SHALL configure the DocumentDB Postgres instance with
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and
`cron.database_name='postgres'` via a chart-managed ConfigMap mounted as a
`postgresql.conf`/`conf.d` include applied before the postmaster process starts —
not via `POSTGRES_EXTRA_ARGS` or any session-level mechanism — so that the GUCs are
applied on every pod start and survive a pod restart without requiring manual
intervention. No additional `documentdb.*` GUCs are mandatory at startup.

#### Scenario: GUCs are active after initial pod start

- **WHEN** the DocumentDB StatefulSet Pod starts for the first time
- **THEN** `SHOW shared_preload_libraries` returns a value containing
  `pg_documentdb_core` and `pg_documentdb`, and `SHOW cron.database_name` returns
  `postgres`

#### Scenario: GUCs survive a pod restart

- **WHEN** the DocumentDB StatefulSet Pod is deleted and a replacement Pod starts
- **THEN** `SHOW shared_preload_libraries` on the new Pod returns the same value
  containing `pg_documentdb_core` and `pg_documentdb`, confirming the ConfigMap-mounted
  configuration is re-applied on restart

#### Scenario: ConfigMap update propagates on next pod restart

- **WHEN** the chart ConfigMap carrying the GUC overrides is updated via `helm upgrade`
  and the DocumentDB Pod is restarted
- **THEN** the updated GUC values are active in the running Postgres process

### Requirement: documentdb extension created in the target database on engine startup

The system SHALL create the `documentdb` extension in the target DocumentDB database
via a Helm init Job that first checks `pg_available_extensions` (consistent with
`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`) and then
executes `CREATE EXTENSION IF NOT EXISTS documentdb`, so that `\dx` shows `documentdb`
in the target database and the FerretDB gateway can connect without manual DDL steps.

#### Scenario: documentdb extension present after chart install

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true` and the init
  Job completes
- **THEN** `SELECT extname FROM pg_extension WHERE extname = 'documentdb'` returns one
  row in the target database, confirming the extension is installed

#### Scenario: extension creation is idempotent on re-install

- **WHEN** the umbrella chart is re-installed or upgraded with `documentdb.enabled=true`
  and the init Job runs again
- **THEN** `CREATE EXTENSION IF NOT EXISTS documentdb` completes without error and
  the extension row count in `pg_extension` remains exactly one

#### Scenario: extension creation is gated on pg_available_extensions

- **WHEN** the init Job runs and `documentdb` is absent from `pg_available_extensions`
  (e.g., wrong image)
- **THEN** the Job fails with a non-zero exit code and does not execute
  `CREATE EXTENSION`, consistent with the guard in `postgres-applier.mjs:111`

### Requirement: DocumentDB engine exposed as ClusterIP-only with no tenant-reachable port

The system SHALL expose the DocumentDB Postgres instance as a ClusterIP Service on
port 5432 only, with no Ingress, Route, NodePort, or LoadBalancer Service type, so
that no tenant-reachable network path reaches the engine directly and all document-store
access is mediated by the FerretDB gateway.

#### Scenario: DocumentDB Service is ClusterIP-only

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** exactly one Service for the DocumentDB engine exists in the namespace, its
  type is ClusterIP, and it listens on port 5432; no NodePort, LoadBalancer, Ingress
  resource, or OpenShift Route exists for the engine

#### Scenario: DocumentDB port is not reachable from outside the cluster

- **WHEN** an attempt is made to connect to the DocumentDB engine from outside the
  Kubernetes cluster
- **THEN** no routable path exists to port 5432 on the engine Pod and the connection
  is refused or times out

### Requirement: DocumentDB StatefulSet complies with OpenShift restricted-v2 SCC

The system SHALL configure the DocumentDB StatefulSet Pods with
`podSecurityContext.fsGroup: 1001`, `fsGroupChangePolicy: OnRootMismatch`, and
`securityContext.runAsNonRoot: true` in the base values, mirroring the existing
Postgres StatefulSet pattern at `charts/in-falcone/values.yaml:1759-1791`, and SHALL
set `podSecurityContext.fsGroup: null` with `seccompProfile.type: RuntimeDefault` in
the OpenShift overlay so that the restricted-v2 SCC injects the namespace-annotated
uid/gid without requiring a custom SCC assignment.

#### Scenario: DocumentDB Pods pass restricted-v2 SCC admission on OpenShift

- **WHEN** the umbrella chart is installed in an OpenShift namespace governed by the
  restricted-v2 SCC with `documentdb.enabled=true` and the OpenShift overlay applied
- **THEN** all DocumentDB Pods are admitted without SCC violation events, reach the
  Running state, and the Postgres process writes to the PVC mount under the injected
  uid/gid

#### Scenario: fsGroup is null in the OpenShift overlay

- **WHEN** the OpenShift overlay (`deploy/openshift/values-openshift.yaml`) is applied
- **THEN** the DocumentDB StatefulSet PodSpec contains no non-null `fsGroup` field and
  `seccompProfile.type` is `RuntimeDefault`

#### Scenario: base values carry fsGroup 1001 and runAsNonRoot true

- **WHEN** the umbrella chart is rendered with the base values (no OpenShift overlay)
  and `documentdb.enabled=true`
- **THEN** the DocumentDB StatefulSet PodSpec sets `fsGroup: 1001`,
  `fsGroupChangePolicy: OnRootMismatch`, and `runAsNonRoot: true`

### Requirement: DocumentDB PVC provides persistent storage and survives pod restart

The system SHALL provision a PersistentVolumeClaim for the DocumentDB StatefulSet data
directory, defaulting to 20 Gi in the dev profile and configurable via chart values,
so that data written to the DocumentDB engine survives pod deletion and rescheduling
without data loss.

#### Scenario: PVC exists after chart install

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** a PVC bound to the DocumentDB StatefulSet Pod exists in the namespace with
  at least 20 Gi capacity and ReadWriteOnce access mode

#### Scenario: Data persists across pod restart

- **WHEN** a document is written to a DocumentDB collection and the StatefulSet Pod is
  deleted and a replacement Pod starts
- **THEN** the document is readable from the same collection after the new Pod reaches
  Ready, confirming PVC persistence

### Requirement: DocumentDB engine is fully ready before FerretDB gateway connects

The system SHALL ensure that the DocumentDB engine (postmaster started, `documentdb`
extension installed, `documentdb_api` schema present in the target database) is in the
Ready state before any FerretDB gateway Pod (`add-ferretdb-gateway`) initiates its
first MongoDB wire-protocol handshake, so that the gateway's first connection does not
fail due to a missing `documentdb_api` schema.

#### Scenario: gateway startup is blocked until engine is ready

- **WHEN** the umbrella chart is installed with both `documentdb.enabled=true` and
  the FerretDB gateway enabled
- **THEN** the FerretDB gateway Pod does not send a wire-protocol connection to the
  DocumentDB engine until the engine's init Job has completed and `documentdb_api`
  schema is present; the gateway reaches the Running state only after the engine
  StatefulSet Pod is Ready

#### Scenario: engine-first startup succeeds; gateway-first fails and is rejected

- **WHEN** the DocumentDB engine Pod is not yet Ready and a FerretDB gateway process
  attempts to connect to the engine Service
- **THEN** the connection is rejected or the gateway enters a CrashLoopBackOff /
  pending state until the engine becomes Ready, after which the gateway successfully
  completes its wire handshake

### Requirement: tests/env provides a DocumentDB engine service for real-stack tests

The system SHALL add a `documentdb` service to `tests/env/docker-compose.yml` using
the image pinned by tag and digest
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`)
with `shared_preload_libraries` and `cron.database_name` applied at startup and the
`documentdb` extension created on startup, so that real-stack integration tests can
target the DocumentDB engine without a Kubernetes cluster.

#### Scenario: tests/env DocumentDB service starts and extension is present

- **WHEN** `docker compose -f tests/env/docker-compose.yml up documentdb` is run
- **THEN** the service reaches a healthy state, `pg_isready` succeeds on the mapped
  host port, and `SELECT extname FROM pg_extension WHERE extname = 'documentdb'`
  returns one row in the target database

#### Scenario: tests/env DocumentDB service does not conflict with the shared Postgres port

- **WHEN** both the shared `postgres` service and the `documentdb` service are started
  in `tests/env`
- **THEN** each service is reachable on a distinct host port (5432 for shared Postgres,
  5433 for DocumentDB) and neither service interferes with the other

### Requirement: FerretDB gateway deployed as a stateless Deployment via chart toggle

The system SHALL deploy the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) as
a stateless Kubernetes Deployment — with a minimum of 2 replicas, no
PersistentVolumeClaim, and HPA-ready resource requests and limits — controlled by a
`ferretdb.enabled` boolean value in the umbrella Helm chart, so that the gateway can
be deployed alongside the existing MongoDB instance during the cutover window without
either being removed from the chart.

#### Scenario: FerretDB gateway Deployment has no PVC and at least 2 replicas

- **WHEN** the umbrella chart is installed with `ferretdb.enabled=true`
- **THEN** a Deployment for the FerretDB gateway exists with `replicas` >= 2, no
  `volumeClaimTemplates`, no PersistentVolumeClaim bound to any gateway Pod, and
  all gateway Pods reach the Ready state

#### Scenario: FerretDB disabled by default produces no gateway resources

- **WHEN** the umbrella chart is installed without overriding `ferretdb.enabled`
- **THEN** no FerretDB Deployment, Service, or ConfigMap is created and the
  existing MongoDB connection path is unaffected

### Requirement: FerretDB gateway exposes MongoDB wire protocol on internal-only ClusterIP Service

The system SHALL expose the FerretDB gateway exclusively via a ClusterIP Service on
port 27017 (MongoDB wire protocol), with no Ingress, Route, NodePort, or
LoadBalancer service type, so that tenant-facing network paths cannot reach the
FerretDB gateway directly and only Falcone's control-plane and CDC services can
consume the `mongodb://` endpoint via `MONGO_URI`.

#### Scenario: MongoDB wire-protocol Service is ClusterIP-only

- **WHEN** the umbrella chart is installed with `ferretdb.enabled=true`
- **THEN** exactly one Service exists for the FerretDB gateway, its type is
  `ClusterIP`, it exposes port 27017, and no Ingress resource, OpenShift Route,
  NodePort, or LoadBalancer Service exists for the gateway

#### Scenario: In-cluster MongoDB connection succeeds and wire-protocol version is as expected

- **WHEN** a Pod inside the cluster connects to the FerretDB ClusterIP Service on
  port 27017 using a MongoDB wire-protocol driver and issues a `hello` (or
  `isMaster`) command
- **THEN** the handshake completes successfully, the gateway returns a `hello`
  response with `maxWireVersion` equal to `21` and `buildInfo.version` equal to
  `7.0.77`, and the connection is usable for document operations; a response with any
  other `maxWireVersion` indicates image drift and MUST be treated as a contract
  failure

### Requirement: FerretDB gateway translates wire protocol to DocumentDB-on-Postgres backend

The system SHALL configure the FerretDB gateway to connect to the DocumentDB
PostgreSQL backend (deployed by `add-ferretdb-documentdb-engine`) via
`FERRETDB_POSTGRESQL_URL` with `sslmode=require`, so that all MongoDB wire-protocol
operations received by the gateway are translated to SQL and executed against the
DocumentDB extension without plaintext PostgreSQL connections.

#### Scenario: Gateway connects to DocumentDB backend with TLS

- **WHEN** the FerretDB gateway Pod starts with `ferretdb.enabled=true`
- **THEN** the gateway establishes a TLS-protected connection to the DocumentDB
  PostgreSQL backend (`sslmode=require`) and the gateway startup logs confirm a
  successful backend connection with no TLS errors

#### Scenario: Document write through gateway persists in DocumentDB

- **WHEN** a MongoDB wire-protocol client issues an `insertOne` command to the
  FerretDB gateway ClusterIP on port 27017
- **THEN** the document is stored in the DocumentDB PostgreSQL backend and a
  subsequent `findOne` via the same gateway returns the inserted document

### Requirement: FerretDB gateway health and readiness probes gate Service endpoint registration

The system SHALL configure a `livenessProbe` and a `readinessProbe` on the FerretDB
gateway container, targeting the FerretDB debug health endpoint or a TCP socket on
port 27017, so that gateway Pods are not added to the ClusterIP Service endpoints
until they are ready to accept MongoDB wire-protocol connections and a crashlooping
gateway is restarted automatically.

#### Scenario: Readiness probe prevents traffic before gateway is ready

- **WHEN** a FerretDB gateway Pod is starting and has not yet established a
  connection to the DocumentDB backend
- **THEN** the Pod's readiness probe fails, the Pod is excluded from the ClusterIP
  Service endpoints, and no MongoDB traffic is routed to it until the probe passes

#### Scenario: Liveness probe triggers restart of a crashed gateway

- **WHEN** the FerretDB gateway process inside a Pod stops responding to the
  liveness probe
- **THEN** Kubernetes restarts the container and the Pod returns to Ready state
  after a successful restart

### Requirement: FerretDB gateway image version must be pinned by tag and digest to match the DocumentDB engine version

The system SHALL pin the FerretDB gateway image to
`ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
— the release corresponding to DocumentDB engine
`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` (MongoDB wire
protocol 7.0, maxWireVersion 21, buildInfo `7.0.77`) — and the chart values MUST
document that the engine must be upgraded before the gateway and that both the image
tag and digest must be updated to the matching FerretDB release when the engine is
upgraded, so that protocol and SQL-translation compatibility is guaranteed and image
drift between environments is detected at pull time.

#### Scenario: Chart renders gateway with the correct pinned image tag and digest

- **WHEN** the umbrella chart is rendered with `ferretdb.enabled=true` and default
  values
- **THEN** the FerretDB gateway Deployment specifies image
  `ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
  and the chart values contain a comment linking this tag and digest to the
  DocumentDB engine version `0.107.0-ferretdb-2.7.0`

#### Scenario: Engine-first upgrade order is documented in chart values

- **WHEN** an operator inspects the `ferretdb.image.tag` value in
  `charts/in-falcone/values.yaml`
- **THEN** a comment is present stating that the DocumentDB engine must be upgraded
  before the gateway image tag is changed and identifying the paired engine image

### Requirement: FerretDB gateway Pods comply with OpenShift restricted-v2 SCC

The system SHALL configure all FerretDB gateway Pods in the OpenShift values overlay
with `runAsNonRoot: true`, `seccompProfile.type: RuntimeDefault`, and no explicit
non-null `fsGroup`, so that the restricted-v2 Security Context Constraint admits the
gateway Pods without a custom SCC assignment and the injected uid/gid from the
namespace annotation is used.

#### Scenario: FerretDB gateway Pods pass restricted-v2 SCC admission on OpenShift

- **WHEN** the umbrella chart is installed in an OpenShift namespace governed by
  the restricted-v2 SCC with `ferretdb.enabled=true` and the OpenShift overlay
  (`deploy/openshift/values-openshift.yaml`) applied
- **THEN** all FerretDB gateway Pods are admitted without SCC violation events,
  reach the Running state, and no privilege-escalation warnings appear in the
  namespace event log

#### Scenario: FerretDB gateway PodSpec contains no explicit fsGroup in the OpenShift overlay

- **WHEN** the OpenShift overlay is applied with `ferretdb.enabled=true`
- **THEN** the FerretDB gateway PodSpec does not contain a non-null `fsGroup` field
  and both `runAsNonRoot: true` and `seccompProfile.type: RuntimeDefault` are
  present in the Pod security context

### Requirement: FerretDB gateway MUST NOT become Ready before the DocumentDB engine extensions are initialised

The system SHALL ensure the FerretDB gateway Deployment does not start (or, if
started, does not pass its readiness probe) until the DocumentDB engine PostgreSQL
instance has had `CREATE EXTENSION documentdb` applied and the `documentdb_api`
schema created, because starting the gateway before extension initialisation causes
the first MongoDB wire handshake to fail.

#### Scenario: Gateway Pod readiness probe fails when engine extensions are not yet initialised

- **WHEN** the FerretDB gateway Pod starts and the DocumentDB engine PostgreSQL
  backend does not yet have the `documentdb` extension loaded or the `documentdb_api`
  schema created
- **THEN** the gateway Pod's readiness probe fails and the Pod is NOT added to the
  ClusterIP Service endpoints, so no MongoDB traffic is routed to it

#### Scenario: Gateway becomes Ready only after engine initialisation completes

- **WHEN** the DocumentDB engine PostgreSQL backend has `CREATE EXTENSION documentdb`
  applied and the `documentdb_api` schema exists, and the FerretDB gateway Pod then
  starts
- **THEN** the gateway Pod passes its readiness probe and is added to the ClusterIP
  Service endpoints, and a `hello` command returns `maxWireVersion` 21

### Requirement: FerretDB gateway backend connection uses bootstrap superuser role; per-tenant MongoDB users map to non-superuser Postgres login roles

The system SHALL configure `FERRETDB_POSTGRESQL_URL` with the DocumentDB
bootstrap/superuser Postgres role so the gateway can manage the backend schema, and
MUST ensure that each MongoDB-level user created via `db.runCommand({createUser})`
maps to a real, non-superuser, non-BYPASSRLS Postgres login role in the DocumentDB
backend, so that per-tenant Postgres roles cannot bypass Row-Level Security policies
applied to DocumentDB tables.  Per-tenant credential provisioning is owned by
`add-ferretdb-tenant-isolation-credentials`.

#### Scenario: Per-tenant MongoDB user maps to a non-superuser non-BYPASSRLS Postgres role

- **WHEN** a per-tenant MongoDB user is created via `db.runCommand({createUser})`
  against the FerretDB gateway
- **THEN** the corresponding Postgres login role in the DocumentDB backend has
  neither `SUPERUSER` nor `BYPASSRLS` privileges, as verified by querying
  `pg_roles` in the DocumentDB PostgreSQL instance

### Requirement: FerretDB gateway v2.7.0 does NOT provide a tenant isolation boundary — application-layer tenantId scoping is authoritative

The system SHALL NOT rely on the FerretDB gateway's per-tenant MongoDB database or
Postgres role assignment as a tenant isolation boundary, because at FerretDB v2.7.0
per-database role scoping is NOT enforced — an authenticated MongoDB user can read
data from other Mongo databases.  Tenant isolation MUST remain enforced exclusively
at the application layer via `tenantId` field scoping in
`apps/control-plane/src/runtime/mongodb-data-api.mjs`, and the FerretDB credential
model (owned by `add-ferretdb-tenant-isolation-credentials`) MUST NOT be presented
to operators as a substitute for that scoping.

#### Scenario: Application-layer tenantId scoping prevents cross-tenant data access through the gateway

- **WHEN** an authenticated MongoDB user for tenant A issues a query to the FerretDB
  gateway without an explicit `tenantId` filter at the application layer
- **THEN** the application layer (`mongodb-data-api.mjs`) rejects or scopes the
  query to tenant A's `tenantId` before it reaches the gateway, so documents
  belonging to tenant B are never returned regardless of FerretDB's role-scoping
  behaviour

#### Scenario: Cross-tenant probe confirms application-layer scoping — not gateway enforcement

- **WHEN** the FerretDB gateway is running and two tenants A and B have documents in
  different Mongo databases
- **THEN** a direct MongoDB driver query from tenant A's credentials to tenant B's
  Mongo database that bypasses `mongodb-data-api.mjs` MAY succeed at the gateway
  layer (confirming the known v2.7.0 limitation), while the same query routed
  through `mongodb-data-api.mjs` returns no tenant B documents

### Requirement: Tenant onboarding provisions a per-tenant DocumentDB credential via wire-protocol createUser

The system SHALL, upon tenant onboarding, issue `db.runCommand({createUser: 'falcone_doc_{tenantId}', roles:[{role:'readWrite', db:'falcone_doc_{tenantId}'}]})` over the MongoDB wire protocol to produce a real Postgres login role (non-superuser, non-BYPASSRLS) scoped to the per-tenant logical namespace `falcone_doc_{tenantId}` — so that every tenant has a dedicated credential for least-privilege auth and audit, separate from the single shared `MONGO_URI` credential in `apps/control-plane/src/runtime/main.mjs::mongoUri`.

Note: `falcone_doc_{tenantId}` is a DocumentDB logical namespace (a `database_name` value in the shared `documentdb_data` schema), **not** a Postgres database. Provisioning is via wire-protocol `createUser`, **not** Postgres `CREATE USER` / `GRANT ALL ON DATABASE` DDL. The GUC names `documentdb.enableUserCrud` / `documentdb.maxUserLimit` are `⚠ not code-verifiable` at this spec revision — a pre-implementation task MUST verify them on postgres-documentdb 17-0.107.0-ferretdb-2.7.0 before the identity applier relies on them.

Evidence: `apps/control-plane/src/runtime/main.mjs:33-42` (single shared `MONGO_URI` / `MONGO_HOST` credential for all tenants); `services/adapters/src/mongodb-data-api.mjs:136,138` (`scoped_credential` / `MONGO_DATA_SCOPED_CREDENTIAL_TYPES` advertised but no backend provisioning); `apps/control-plane/src/mongo-data-api.mjs:73-81` (scoped_credential route wired, no executor implementation); `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` (manages `['schemas','tables','views','extensions','grants']` only — no role or identity logic; DocumentDB identity provisioning is net-new).

#### Scenario: Tenant onboarding creates a DocumentDB credential via wire protocol

- **WHEN** the provisioning orchestrator processes a new tenant onboarding event
- **THEN** the system MUST issue the MongoDB wire-protocol `createUser` command for `falcone_doc_{tenantId}` against the DocumentDB engine, confirm the Postgres login role exists (non-superuser, non-BYPASSRLS), persist the `credentialRef` via Vault/ESO (no plaintext), and mark onboarding complete only after the credential is confirmed

#### Scenario: Duplicate onboarding is idempotent and does not overwrite an existing credential

- **WHEN** the provisioning orchestrator calls the DocumentDB identity applier for a tenant that already has an active credential
- **THEN** the system MUST detect the existing credential and return without issuing duplicate `createUser` or overwriting the existing password

#### Scenario: Provisioning failure blocks tenant activation

- **WHEN** the DocumentDB identity applier cannot issue `createUser` (engine error, configuration failure, or capacity limit)
- **THEN** the system MUST throw a provisioning error, MUST NOT mark onboarding complete, and MUST NOT activate the tenant with the shared `MONGO_URI` credential

### Requirement: Per-tenant DocumentDB credential rotation is implemented and does not orphan access

The system SHALL implement credential rotation for per-tenant DocumentDB credentials: issue `db.runCommand({updateUser: 'falcone_doc_{tenantId}', pwd: '<new>'})` over the MongoDB wire protocol, update the Vault/ESO secret (consistent with ADR-9), emit a `credential_rotation` audit event, and invalidate the previous password immediately.

Evidence: `services/adapters/src/mongodb-data-api.mjs:136` (`scoped_credential` management capability); `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs` (sweep pattern for credential rotation); Vault/ESO credential storage pattern (ADR-9).

#### Scenario: Manual rotation updates the DocumentDB credential and invalidates the old password

- **WHEN** a tenant admin triggers credential rotation for the document-store scoped credential
- **THEN** the system MUST issue the wire-protocol `updateUser` command with the new password, update the Vault/ESO secret, confirm the previous password is no longer accepted, and deliver the new credential exactly once through the secret envelope

#### Scenario: Policy-sweep rotation applies and audits the rotation event

- **WHEN** the credential expiry sweep finds a per-tenant DocumentDB credential whose policy expiry has elapsed
- **THEN** the system MUST rotate the credential via `updateUser`, update the Vault/ESO secret, and emit a `credential_rotation` audit event with `rotationReason: "policy_expiry"` — no rotation attempt is silently skipped

### Requirement: App-layer tenantId scoping is retained as the authoritative isolation layer for all data-api operations

The system SHALL retain `applyTenantScopeToFilter` and `injectTenantIntoDocument` in `services/adapters/src/mongodb-data-api.mjs:620,655` as active on every document-store read and write operation — so that the application layer remains the authoritative isolation boundary and per-tenant credentials serve as least-privilege auth and audit, not as the sole isolation mechanism.

Evidence: `services/adapters/src/mongodb-data-api.mjs:620` (`applyTenantScopeToFilter`); `services/adapters/src/mongodb-data-api.mjs:655` (`injectTenantIntoDocument`); ADR-14 spike: cross-tenant read succeeds when the app-layer filter is bypassed — the app layer is the only reliable isolation gate at this engine version.

#### Scenario: App-layer filter is applied on every data-api read regardless of per-tenant credential

- **WHEN** a document find or aggregate is issued via the data-api executor
- **THEN** `applyTenantScopeToFilter` MUST inject a `tenantId` predicate before the MongoDB wire-protocol command is issued, in addition to routing the connection via the per-tenant credential

#### Scenario: App-layer stamp is applied on every data-api write regardless of per-tenant credential

- **WHEN** a document insert, update, replace, or bulk-write is issued via the data-api executor
- **THEN** `injectTenantIntoDocument` MUST stamp the `tenantId` field into the document before it is persisted, in addition to routing the connection via the per-tenant credential

### Requirement: Tenant->namespace/collection mapping is preserved at parity with the pre-migration MongoDB model

The system SHALL map each tenant's document collections to the per-tenant DocumentDB logical namespace (`falcone_doc_{tenantId}`) using the same collection names that existed under the shared MongoDB connection — so that the existing `applyTenantScopeToFilter` / `injectTenantIntoDocument` logic operates identically and no data migration is required for collection naming.

Evidence: `services/adapters/src/mongodb-data-api.mjs:620,655` (app-layer scoping uses collection names unchanged from the pre-migration model); ADR-14 spike (logical namespace confirmed as the per-tenant collection container).

#### Scenario: Collection operations target the per-tenant namespace and preserve collection names

- **WHEN** a tenant issues a document insert, find, update, or delete operation via the data-api
- **THEN** the system MUST route the MongoDB wire-protocol request to the tenant's dedicated DocumentDB logical namespace (`falcone_doc_{tenantId}`) using the same collection name that was used under the pre-migration shared MongoDB connection — no collection rename or remapping is applied

### Requirement: Tenant offboarding revokes the per-tenant DocumentDB credential with no orphaned access

The system SHALL, upon tenant offboarding or deletion, issue `db.runCommand({dropUser: 'falcone_doc_{tenantId}'})` over the MongoDB wire protocol and clean up the tenant's collections in the logical namespace — confirming the credential is gone before the tenant record is considered fully purged — so that no orphaned per-tenant DocumentDB credential remains after offboarding.

Evidence: `services/provisioning-orchestrator/src/` (tenant lifecycle and deletion cascade patterns); `apps/control-plane/src/runtime/main.mjs:33-42` (no per-tenant identity revocation exists today).

#### Scenario: Tenant deletion revokes the DocumentDB credential

- **WHEN** the provisioning orchestrator processes a tenant deletion event
- **THEN** the system MUST issue the wire-protocol `dropUser` command for `falcone_doc_{tenantId}` and confirm the Postgres login role no longer exists before the deletion event is marked complete

#### Scenario: Offboarding with no existing DocumentDB credential is a no-op

- **WHEN** the provisioning orchestrator processes a tenant deletion for a tenant that was never provisioned with a DocumentDB credential (e.g., onboarded before this change)
- **THEN** the system MUST complete offboarding cleanly without error — the absence of a per-tenant DocumentDB credential is treated as an already-clean state

### Requirement: Adapter aggregation stage allowlist and blocked-stage policy are unchanged

The system SHALL preserve the existing adapter aggregation stage allowlist
(`$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`, `$unwind`, `$lookup` ≤1,
`$count`, `$facet` ≤4, `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`)
and the existing `AGGREGATION_BLOCKED_STAGES` (`$out`, `$merge`, `$geoNear`) in
`services/adapters/src/mongodb-data-api.mjs` after the FerretDB cutover. The blocked
stages are rejected as **intentional adapter policy** — they are engine-functional on
FerretDB but blocked by the allowlist by design. The `$facet≤4` and `$lookup≤1` caps are
likewise adapter policy, not engine constraints. No new `FERRETDB_UNSUPPORTED_OPERATOR`
error code is introduced.

#### Scenario: Already-blocked stages ($out, $merge, $geoNear) continue to be rejected

- **WHEN** a caller submits an aggregate request containing `$out`, `$merge`, or `$geoNear`
- **THEN** the response status is 422 or 400 and no database command is dispatched,
  identical to pre-FerretDB behavior (adapter policy, not engine limitation)

#### Scenario: Pipeline with all adapter-allowed stages executes normally on FerretDB

- **WHEN** a caller submits an aggregate request whose pipeline uses only stages from
  the adapter allowlist (`$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`,
  `$unwind`, `$count`, `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`,
  `$lookup` with at most 1 stage, `$facet` with at most 4 sub-stages)
- **THEN** the plan is built and executed against FerretDB and the response contains the
  aggregation result with status 200

### Requirement: Multi-document transaction ops are rejected at the API boundary before any op runs

The system SHALL expose `supportsTransactions=false` via `resolveMongoDataCapabilityCompatibility`
when the connected backend is FerretDB, and the plan builder or executor SHALL reject any
`transaction` op **at the API boundary before dispatching any individual op**, returning
HTTP 501 with `code: "TRANSACTION_NOT_SUPPORTED"`. No individual op within the transaction
SHALL be dispatched to the database. This boundary-first guard is mandatory because FerretDB
`commitTransaction` → CommandNotFound(59), individual ops already persist non-atomically
before commit, and `abortTransaction` is a silent no-op (no rollback) — a commit-time or
lazy guard would leave partial writes committed with no recovery path.

#### Scenario: Transaction op is rejected at the API boundary before any individual op runs

- **WHEN** the executor is configured for a FerretDB backend (`supportsTransactions=false`)
  and a caller submits a `transaction` op
- **THEN** the response status is 501 with `code: "TRANSACTION_NOT_SUPPORTED"` and no
  individual ops within the transaction are dispatched to the database

#### Scenario: Transaction op on a backend that supports transactions executes atomically

- **WHEN** the executor is connected to a backend that supports multi-document transactions
  (e.g., MongoDB 7) and a caller submits a valid `transaction` op
- **THEN** the transaction is executed atomically and the response reflects the outcome
  of all included ops

### Requirement: Snapshot/majority read-write concerns are stripped for FerretDB

The system SHALL NOT attach `readConcern:'snapshot'` or `writeConcern:'majority'` to
operation plans dispatched to a FerretDB backend in `services/adapters/src/mongodb-data-api.mjs`,
because FerretDB silently ignores these concerns and carrying them forward creates a false
guarantee of atomicity and consistency. These concern declarations SHALL be omitted or
stripped before the plan is handed to the executor.

#### Scenario: Plan dispatched to FerretDB carries no snapshot or majority concern

- **WHEN** a caller submits any operation (including a transaction-boundary op) and the
  backend is FerretDB
- **THEN** the built plan contains no `readConcern:'snapshot'` or `writeConcern:'majority'`
  field, and the executor dispatches the plan without those concerns

### Requirement: Real-stack test environment runs FerretDB+DocumentDB with engine-first startup order

The system SHALL run the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) backed by
the DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
in `tests/env/docker-compose.yml` instead of `mongo:7 --replSet rs0`, listening on port
57017. The FerretDB gateway service SHALL declare `depends_on` with a healthcheck condition
on the DocumentDB engine service so that the engine is healthy before the gateway starts.

#### Scenario: Real-stack executor tests pass against FerretDB docker-compose stack

- **WHEN** `tests/env/docker-compose.yml` is started and `tests/env/executor/mongo-data-executor.test.mjs`
  is run
- **THEN** all CRUD and aggregation test cases pass against the FerretDB gateway, and
  the transaction-boundary-rejected case returns 501 with `code: "TRANSACTION_NOT_SUPPORTED"`

#### Scenario: FerretDB gateway starts only after DocumentDB engine healthcheck passes

- **WHEN** `docker-compose up` is executed in `tests/env/`
- **THEN** the FerretDB gateway container does not start accepting connections until the
  DocumentDB engine container healthcheck has passed, preventing premature connection failures

#### Scenario: FerretDB gateway is reachable on port 57017 after docker-compose up

- **WHEN** `docker-compose up` completes in `tests/env/` and the FerretDB gateway healthcheck passes
- **THEN** a MongoDB wire-protocol connection to `mongodb://localhost:57017` succeeds and
  returns a valid `isMaster` response

### Requirement: Tenant-facing /v1/collections/* API contract is unchanged after FerretDB cutover

The system SHALL preserve all existing `/v1/collections/*` route shapes, request schemas,
and response schemas (`services/gateway-config/public-route-catalog.json`) after the
FerretDB cutover, so that tenants and SDK consumers experience no breaking change.

#### Scenario: Contract tests pass with MONGO_URI pointing at FerretDB

- **WHEN** `tests/contracts/mongodb-data-api.compatibility.test.mjs` and
  `tests/contracts/mongodb-admin.compatibility.test.mjs` are executed against a runtime
  whose `MONGO_URI` points at a FerretDB gateway
- **THEN** all contract assertions pass with no schema or route violations

#### Scenario: Adapter plan builder tests pass without modification

- **WHEN** `tests/adapters/mongodb-data-api.test.mjs` is run
- **THEN** all existing assertions pass and the new boundary-guard and concern-stripping
  assertions also pass

### Requirement: Dedicated engine topology and engine-first startup order are established before migration begins

The system SHALL require that the FerretDB migration runs against a dedicated
Postgres engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
that is not colocated with the existing Postgres instance, and SHALL enforce an
engine-first startup order in which the postgres-documentdb pod reaches Ready
before the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) starts, such
that the migration runbook asserts both preconditions before any data transfer
begins.

#### Scenario: Migration halts when engine pod is not Ready before gateway start

- **WHEN** the migration runbook executes its precondition check and the
  postgres-documentdb engine pod is not yet in Ready state
- **THEN** the runbook halts immediately, prints a message identifying the
  engine-not-ready condition, and does not start the FerretDB gateway or
  any data transfer

#### Scenario: Migration proceeds when dedicated engine is Ready and gateway is up

- **WHEN** the migration runbook executes its precondition check and the
  postgres-documentdb engine pod is Ready and the FerretDB gateway is reachable
- **THEN** the runbook advances to the bulk copy phase

### Requirement: Initial bulk copy performs idempotent single-document upserts keyed on _id

The system SHALL provide a migration script that performs a snapshot export
(`mongodump`) from the source MongoDB replica set (bitnami/mongodb:8.0.0,
`MONGO_URI` — `apps/control-plane/src/runtime/main.mjs::mongoUri`) and then
applies every exported document to FerretDB (`ghcr.io/ferretdb/ferretdb:2.7.0`)
as an idempotent single-document upsert keyed on `_id` (replaceOne with
`upsert:true`), preserving the tenant-to-collection mapping (documents carry the
`tenantId` field), such that the script is re-runnable and a partial failure
leaves FerretDB in a consistent sub-state that can be safely continued without
re-running from the beginning.

The script SHALL NOT use transactional batch apply: `commitTransaction` returns
CommandNotFound(59) on FerretDB and in-transaction writes persist without
atomicity; `abortTransaction` is a silent no-op.

The script SHALL NOT use `mongorestore --oplogReplay` for delta convergence:
oplog replay requires atomic multi-doc apply, which is unsupported on FerretDB,
and will not converge.

#### Scenario: Initial bulk copy transfers all documents for all configured databases

- **WHEN** the migration script is invoked in initial mode against a MongoDB
  replica set with one or more populated tenant collections
- **THEN** every document in each configured database and collection is present
  on FerretDB with the same `_id`, field values, and `tenantId` after the
  script exits successfully

#### Scenario: Partial failure on initial copy is safely retried without duplication

- **WHEN** the migration script fails partway through the initial bulk copy and
  is re-invoked in initial mode without manual cleanup
- **THEN** documents already upserted on FerretDB are updated in place (not
  duplicated), remaining documents are upserted, and the script exits zero once
  all documents are present

### Requirement: Delta convergence uses re-export and idempotent upsert inside the write-freeze window

The system SHALL provide a delta convergence step that runs inside the
maintenance-window write-freeze: the operator re-exports documents modified on
MongoDB since the initial copy timestamp (via `mongodump` with a timestamp-based
query filter, or a full re-export for collections without an update-time field)
and applies them to FerretDB as idempotent `_id` upserts, such that once the
write-freeze prevents new writes from arriving on MongoDB, the FerretDB target
converges exactly to the source state at freeze time.

The delta convergence step SHALL NOT use oplog replay (`mongodump --oplog` /
`mongorestore --oplogReplay`): oplog replay requires atomic multi-document apply
which is non-atomic on FerretDB and will not converge.

#### Scenario: Delta convergence applied during write-freeze produces exact source parity

- **WHEN** the delta re-export and idempotent upsert step completes inside the
  write-freeze window against a MongoDB source where no new writes can arrive
- **THEN** the per-collection document count on FerretDB equals the count on
  MongoDB, and the per-collection checksum on FerretDB equals the checksum on
  MongoDB, and the script exits zero

#### Scenario: Delta convergence is idempotent on re-run

- **WHEN** the delta upsert step is executed a second time against the same
  FerretDB target without any changes to the source
- **THEN** no duplicate documents are inserted, document counts are unchanged,
  and the script exits zero

### Requirement: Index migration recreates all index types from MongoDB on FerretDB without type-based halting

The system SHALL introspect all non-`_id` indexes on the source MongoDB instance,
export their definitions to a machine-readable JSON file, and recreate each index
on the FerretDB target after the restore completes.

The script SHALL NOT halt on text or 2dsphere index types: both are functional
on FerretDB 2.7.0 (the engine bundles rum and postgis extensions). The script
SHALL recreate single, compound, unique, sparse, and TTL indexes in addition to
text and 2dsphere indexes. The only constraint that applies at the stage level is
the adapter allowlist blocking `$out` and `$merge` aggregation stages, which is
not an index concern and does not affect index migration.

#### Scenario: All non-_id indexes including text and 2dsphere are created on FerretDB

- **WHEN** the index recreation script is run after a successful initial copy
  against a FerretDB instance containing the migrated collections
- **THEN** every non-`_id` index exported from MongoDB is present on FerretDB
  with the same name, key pattern, and options (including text and 2dsphere
  index types), and the script exits zero

#### Scenario: Index recreation log records pass or fail per index

- **WHEN** the index recreation script completes (successfully or with errors)
- **THEN** for each index it prints either `PASS: index <name> on
  <db>.<collection>` or `FAIL: index <name> on <db>.<collection>
  error=<message>`, and the script exits non-zero if any index failed

### Requirement: Integrity verification compares per-collection document counts, checksums, and index presence

The system SHALL capture per-collection integrity snapshots — document count,
sha256 checksum over `_id`-sorted documents, and index presence — from both
the MongoDB source and the FerretDB target, and SHALL provide a comparison
tool that exits non-zero and reports divergences when any collection's count,
checksum, or index presence differs between source and target.

#### Scenario: Pre-copy snapshot is written before any data transfer

- **WHEN** the migration script starts
- **THEN** a pre-copy snapshot file is written containing, for each configured
  collection, the document count, checksum, and index list sourced from MongoDB
  before any data transfer begins

#### Scenario: Post-delta snapshot is written after delta convergence completes

- **WHEN** the delta upsert step completes successfully inside the write-freeze
  window
- **THEN** a post-delta snapshot file is written containing, for each migrated
  collection, the document count, checksum, and index list sourced from FerretDB

#### Scenario: Snapshot comparison detects count or checksum divergence

- **WHEN** the post-delta snapshot is compared against the pre-copy snapshot
  and at least one collection has a differing document count or checksum
- **THEN** the comparison tool reports the diverging collection name, the
  expected and observed values, and exits non-zero

#### Scenario: Snapshot comparison confirms parity on matching state

- **WHEN** the post-delta snapshot is compared against the pre-copy snapshot
  and all collections have identical document counts, checksums, and index
  presence
- **THEN** the comparison tool prints a parity-confirmed summary and exits zero

### Requirement: Cutover runbook is a maintenance-window write-freeze procedure with no dual-write alternative

The system SHALL provide a committed, operator-executable cutover runbook using
maintenance-window write-freeze as the only valid cutover model. The zero-downtime
/ dual-write alternative SHALL NOT be present in the runbook: change streams are
unsupported on FerretDB (`watch()` returns CommandNotSupported(115)) and any
CDC-based sync path cannot run against FerretDB.

The runbook SHALL consist of the following ordered steps with explicit gates and
rollback instructions between them:
(1) Precondition check: dedicated engine Ready, gateway reachable, version pair
    confirmed (ferretdb:2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0).
(2) Write-freeze / maintenance-window start.
(3) Delta re-export from MongoDB of documents changed since the initial copy.
(4) Idempotent `_id` upsert of re-exported documents into FerretDB.
(5) Index recreation on FerretDB.
(6) Run snapshot comparison (counts, checksums, index presence); gate: parity
    confirmed.
(7) Re-point Falcone to FerretDB: update `MONGO_URI`
    (`apps/control-plane/src/runtime/main.mjs::mongoUri`) to the FerretDB
    gateway endpoint; confirm engine-first startup order is satisfied; perform
    Helm upgrade / pod restart.
(8) Exit maintenance window / switch traffic.

The runbook SHALL include a prominent notice that realtime/CDC features
(realtime-executor, mongo-cdc-bridge) are non-functional on FerretDB after
cutover and direct the operator to `add-ferretdb-realtime-cdc-remediation`
before enabling those features.

Each step SHALL declare its gate criterion and a rollback instruction; the
rollback section SHALL reference `add-ferretdb-rollback-plan` as the full
rollback procedure.

#### Scenario: Runbook completes successfully under maintenance-window mode

- **WHEN** an operator executes the cutover runbook in maintenance-window mode
  with the dedicated engine Ready, the FerretDB gateway reachable, the delta
  upsert producing a matching post-delta snapshot, and all indexes recreated
  successfully
- **THEN** each step exits its gate with a pass result, Falcone is re-pointed
  to FerretDB via `MONGO_URI` with the engine-first startup order satisfied,
  traffic is switched, and the runbook records a completion timestamp

#### Scenario: Runbook step failure triggers rollback instruction

- **WHEN** any runbook step exits with a non-zero status or its gate criterion
  is not met
- **THEN** the runbook halts at that step, prints the step-specific rollback
  instruction and a reference to `add-ferretdb-rollback-plan`, and does not
  advance to subsequent steps

#### Scenario: MONGO_URI revert restores MongoDB traffic without data loss

- **WHEN** the operator executes the rollback procedure after a failed cutover
- **THEN** `MONGO_URI` is reverted to the original MongoDB endpoint, Falcone
  resumes serving requests from MongoDB, and no tenant documents have been
  modified on the source MongoDB during the migration window

#### Scenario: Runbook warns that realtime and CDC are non-functional after cutover

- **WHEN** an operator reads the cutover runbook
- **THEN** a prominent notice is present stating that realtime/CDC features are
  non-functional on FerretDB (change streams unsupported) and directing the
  operator to `add-ferretdb-realtime-cdc-remediation` before enabling those
  features post-cutover

### Requirement: Cutover runbook is exercised end-to-end against a non-prod environment with results recorded

The system SHALL require that the cutover runbook is executed in full against a
non-production copy of the MongoDB data (tests/env mongo:7 or local Docker
Compose) before production use, and that the results — including pre/post
snapshots, index recreation log, and per-step outcomes — are recorded in a
runbook-results artifact committed alongside the runbook.

#### Scenario: Non-prod dry-run produces a committed results artifact

- **WHEN** the cutover runbook completes (successfully or with documented
  failures) against a non-prod environment
- **THEN** a runbook-results file is produced capturing the environment
  identifier, execution timestamp, sha256 digests of the pre/post snapshot
  files, index recreation pass/fail per collection, and the outcome of each
  runbook step, and this file is committed to the repository

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

### Requirement: MongoDB read-only retention window post-cutover

After cutover to FerretDB+DocumentDB, the system SHALL retain the MongoDB StatefulSet
in a read-only state and SHALL NOT reclaim its PVC until the rollback window (N days,
default 7) has elapsed and the non-prod rollback test gate has passed.

#### Scenario: MongoDB StatefulSet is present and PVC is bound after cutover

- **WHEN** the FerretDB+DocumentDB cutover has been completed (`MONGO_URI` re-pointed
  to the FerretDB gateway in `apps/control-plane/src/runtime/main.mjs`)
- **THEN** the MongoDB StatefulSet SHALL still exist in the cluster
- **THEN** the MongoDB PVC SHALL be in Bound state
- **THEN** no new write requests SHALL be routed to MongoDB

#### Scenario: MongoDB PVC is not deleted before window closes

- **WHEN** the rollback window has NOT yet elapsed
- **THEN** any operator attempt to delete the MongoDB PVC SHALL be blocked by the
  runbook gate (documented warning: point-of-no-return not yet reached)

### Requirement: The system SHALL retain the FerretDB Postgres engine PVC as a separate item during the window

The system SHALL retain the Postgres engine PVC for the duration of the rollback window
alongside the MongoDB PVC. The FerretDB Postgres engine PVC is a distinct retention item
from the MongoDB PVC. If the FerretDB stack requires a restart during the window,
the system SHALL start the Postgres DocumentDB engine before starting the FerretDB gateway
(ENGINE-FIRST ordering).

#### Scenario: Both PVCs are present during the rollback window

- **WHEN** the rollback window is active
- **THEN** the MongoDB PVC SHALL be in Bound state (rollback anchor)
- **THEN** the FerretDB Postgres engine PVC SHALL be in Bound state (separate retention item)
- **THEN** the FerretDB gateway SHALL NOT be started before the Postgres DocumentDB engine
  is healthy (ENGINE-FIRST ordering)

### Requirement: Documented rollback procedure with trigger conditions

The system SHALL provide an ordered rollback procedure checklist that includes: trigger
conditions, steps to freeze writes, re-point `MONGO_URI` back to MongoDB (reversing the
`apps/control-plane/src/runtime/main.mjs::mongoUri` resolution — this restores the DATA-API
path and is config-only), decommission the Postgres pgoutput realtime/CDC pipeline
(`add-ferretdb-realtime-cdc-remediation` components), restore the MongoDB change-stream path
by REDEPLOYING the pre-#460 release image of the control-plane and `mongo-cdc-bridge` (the
build whose `apps/control-plane/src/runtime/realtime-executor.mjs` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` still call `collection.watch()`;
#460 re-architected the current build onto pgoutput, so a `MONGO_URI` re-point alone does
NOT restore realtime), a per-tenant data-API smoke validation step, confirmation that
MongoDB change-stream delivery is functional after rollback, a resume step, and the
point-of-no-return marker.

#### Scenario: Rollback triggered by FerretDB failure within window

- **WHEN** a FerretDB+DocumentDB operational failure occurs within the rollback window
- **THEN** the operator SHALL execute the rollback procedure in order:
  (1) freeze writes,
  (2) re-point `MONGO_URI` to MongoDB endpoint,
  (3) decommission the Postgres pgoutput realtime/CDC pipeline
      (`add-ferretdb-realtime-cdc-remediation` components),
  (4) restore the MongoDB change-stream path by redeploying the pre-#460 image (whose
      `realtime-executor.mjs` / `ChangeStreamWatcher.mjs` still call `collection.watch()`)
      against the retained MongoDB, and confirm `collection.watch()` is functional
      against MongoDB,
  (5) run per-tenant data-API smoke test,
  (6) confirm smoke green and MongoDB change-stream delivery verified,
  (7) resume traffic
- **THEN** the per-tenant data-API smoke test SHALL pass before traffic is resumed
- **THEN** MongoDB change-stream delivery SHALL be confirmed functional before traffic
  is resumed

#### Scenario: Rollback procedure includes best-effort delta-back sync note

- **WHEN** rollback is triggered and writes have landed on the FerretDB Postgres engine
  during the window
- **THEN** the runbook SHALL note that those writes cannot be synced back via change
  streams or oplog tailing (both unsupported on FerretDB; `CommandNotSupported(115)`)
- **THEN** the runbook SHALL document the delta-back sync option as a best-effort
  idempotent single-document UPSERT export keyed on `_id` from the DocumentDB Postgres
  engine into MongoDB
- **THEN** the operator SHALL explicitly acknowledge the best-effort nature of the
  delta-back sync before rollback is marked complete

### Requirement: The rollback procedure SHALL transition realtime and CDC from the pgoutput pipeline back to MongoDB change streams

The rollback procedure SHALL decommission the Postgres pgoutput logical-replication
pipeline (`add-ferretdb-realtime-cdc-remediation`) and SHALL restore the MongoDB
change-stream path by REDEPLOYING the pre-#460 release image of the control-plane and
`mongo-cdc-bridge` (the build that still calls `collection.watch()`). During the FerretDB
window, realtime and CDC are served exclusively by that pgoutput pipeline, and the current
build contains no MongoDB change-stream code, so a `MONGO_URI` re-point alone SHALL NOT be
treated as restoring realtime. The system SHALL NOT attempt to verify change-stream delivery
against FerretDB at any point — change streams are unsupported on FerretDB
(`CommandNotSupported(115)` is why #460 removed `collection.watch()` from
`realtime-executor.mjs` and `ChangeStreamWatcher.mjs`); the verification gate applies only
to MongoDB after rollback.

#### Scenario: pgoutput pipeline decommissioned before MongoDB change-stream path is restored

- **WHEN** the `MONGO_URI` has been re-pointed to MongoDB as part of rollback
- **THEN** the operator SHALL decommission the Postgres pgoutput realtime/CDC pipeline
  components introduced by `add-ferretdb-realtime-cdc-remediation`
- **THEN** the operator SHALL restore the MongoDB change-stream path by redeploying the
  pre-#460 release image (whose `realtime-executor.mjs` / `ChangeStreamWatcher.mjs` still
  call `collection.watch()`); a `MONGO_URI` re-point alone does NOT restore realtime
- **THEN** `collection.watch()` SHALL be confirmed functional against MongoDB before
  writes are resumed
- **THEN** no verification of change-stream delivery SHALL be attempted against FerretDB

#### Scenario: MongoDB change-stream delivery confirmed functional after rollback

- **WHEN** the MongoDB change-stream path has been restored
- **THEN** the system SHALL confirm that `collection.watch()` on MongoDB returns a valid
  change stream cursor without raising `CommandNotSupported`
- **THEN** the CDC bridge (`services/mongo-cdc-bridge/`) SHALL be confirmed as connected
  to MongoDB before writes are resumed

### Requirement: Pre-#460 change-stream image is recorded before cutover for realtime rollback

The system SHALL record, before cutover, the release image tag of the control-plane and
`mongo-cdc-bridge` that still contains the MongoDB `collection.watch()` path — the last
build before `add-ferretdb-realtime-cdc-remediation` (#460) re-architected realtime/CDC onto
the Postgres pgoutput pipeline. A realtime/CDC rollback redeploys this image against the
retained MongoDB; the rollback CANNOT restore realtime from an image that was never
preserved, because the post-#460 build has no `collection.watch()` code.

#### Scenario: Pre-#460 image tag is recorded at cutover time

- **WHEN** the cutover runbook step is initiated
- **THEN** the operator SHALL record the pre-#460 control-plane and `mongo-cdc-bridge` image
  tag (the build containing `collection.watch()`) in the rollback runbook
- **THEN** the recorded image tag SHALL be the redeploy target for the realtime/CDC rollback
  step

#### Scenario: Realtime rollback redeploys the recorded pre-#460 image

- **WHEN** a realtime/CDC rollback is executed and the `MONGO_URI` has been re-pointed to
  MongoDB
- **THEN** the operator SHALL redeploy the recorded pre-#460 image against the retained
  MongoDB rather than relying on the `MONGO_URI` re-point to restore realtime
- **THEN** `collection.watch()` SHALL be confirmed functional against MongoDB on the
  redeployed image before writes are resumed

### Requirement: Non-prod rollback validation gate before decommission

Before the MongoDB StatefulSet and PVC are deleted, the system SHALL require that the
rollback procedure has been successfully executed and validated against a non-prod
environment: re-point `MONGO_URI` to MongoDB, decommission pgoutput pipeline, restore
MongoDB change-stream path, per-tenant data-API smoke green, MongoDB change-stream
delivery verified functional.

#### Scenario: Decommission blocked until non-prod test is green

- **WHEN** the rollback window has elapsed
- **THEN** the operator SHALL execute the rollback procedure on a non-prod copy of the
  environment
- **THEN** the per-tenant data-API smoke test SHALL pass on the non-prod copy
- **THEN** MongoDB change-stream delivery SHALL be verified functional on the non-prod
  copy before the decommission step is unblocked

#### Scenario: Decommission proceeds after gate passes

- **WHEN** the non-prod rollback test is green
- **THEN** the operator SHALL delete the MongoDB StatefulSet and PVC (if MongoDB is the
  definitive target) OR the FerretDB Postgres engine, gateway, and their PVC (if
  rollback is confirmed unnecessary and FerretDB is the definitive target)
- **THEN** the side-by-side chart toggle SHALL be updated in `charts/in-falcone/values.yaml`
- **THEN** the decommission date, executor, and final smoke result SHALL be recorded in
  the runbook

### Requirement: Point-of-no-return defined and communicated

The system SHALL define and record in the rollback runbook the point-of-no-return: the
moment the MongoDB PVC is reclaimed. After this point, rollback to MongoDB is not
possible without a restore from backup.

#### Scenario: Operator informed of point-of-no-return before PVC deletion

- **WHEN** an operator initiates the MongoDB PVC deletion step
- **THEN** the runbook SHALL display a warning that deleting the PVC makes rollback
  impossible without a backup restore
- **THEN** the operator SHALL confirm the non-prod gate result before proceeding

#### Scenario: Rollback attempted after point-of-no-return

- **WHEN** the MongoDB PVC has been deleted
- **THEN** rollback to MongoDB SHALL NOT be possible via the standard procedure
- **THEN** the runbook SHALL direct the operator to the backup-restore capability for
  recovery

### Requirement: Window length and decommission outcome recorded

The system SHALL record the chosen rollback window length (N days) and the decommission
outcome (date, executor, smoke result, delta-back sync acknowledgement) in the runbook
at the time of execution.

#### Scenario: Window length confirmed before cutover

- **WHEN** the cutover runbook step is initiated
- **THEN** the operator SHALL confirm the rollback window length (default 7 days) and
  record it in the runbook before proceeding with the cutover

### Requirement: Real-stack document-store E2E suite against FerretDB on kind

The system SHALL provide a Playwright E2E suite that validates document CRUD
(`POST /v1/collections/{name}/documents`, `GET /v1/collections/{name}/documents`,
`PUT /v1/collections/{name}/documents/{id}`, `DELETE /v1/collections/{name}/documents/{id}`),
query (`POST /v1/collections/{name}/query`), and aggregation
(`POST /v1/collections/{name}/search`) against a FerretDB gateway
(`ghcr.io/ferretdb/ferretdb:2.7.0`) and DocumentDB engine
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) backend
deployed by `tests/e2e/stack.sh` on the kind test cluster.

> **Known out-of-scope:** the realtime/CDC suite (`tests/e2e/realtime/`) is owned by
> `add-ferretdb-realtime-cdc-remediation` (#460, MERGED), which re-architected realtime
> onto a Postgres pgoutput logical-replication slot — `apps/control-plane/src/runtime/
> realtime-executor.mjs` no longer calls `collection.watch()` (it consumes a
> `WalReplicationClient` against the DocumentDB engine). Those specs are a SEPARATE,
> pgoutput-based suite; this requirement neither runs nor modifies them. (Mongo change
> streams were only ever unsupported on FerretDB — `CommandNotSupported(115)` /
> `UnknownBsonField(40415)` — which is exactly why #460 removed that path.)

#### Scenario: Create document returns HTTP 201 with a document ID
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/documents` with a valid JSON body
- **THEN** the response status is 201 and the response body contains a document `id` field

#### Scenario: List documents returns the created document
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/collections/{name}/documents` after a document has been created in that collection
- **THEN** the response status is 200 and the response body contains an array that includes the previously created document

#### Scenario: Update document returns HTTP 200 with updated fields
- **WHEN** an authenticated Tenant A request is sent to `PUT /v1/collections/{name}/documents/{id}` with a valid JSON body replacing a previously created document
- **THEN** the response status is 200 and a subsequent `GET /v1/collections/{name}/documents` returns the updated field values

#### Scenario: Delete document returns HTTP 200 and document is absent on subsequent list
- **WHEN** an authenticated Tenant A request is sent to `DELETE /v1/collections/{name}/documents/{id}` for an existing document
- **THEN** the response status is 200 and a subsequent `GET /v1/collections/{name}/documents` does not include that document

#### Scenario: Query returns only matching documents
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/query` with a filter that matches a known subset of documents
- **THEN** the response status is 200 and the response body contains only documents satisfying the filter

#### Scenario: Unauthenticated request is rejected
- **WHEN** a request without authentication credentials is sent to `GET /v1/collections/{name}/documents`
- **THEN** the response status is 401

---

### Requirement: Aggregation pipeline — adapter-allowed stages pass affirmatively on FerretDB

The system SHALL execute all adapter-allowed aggregation stages via
`POST /v1/collections/{name}/search` against the FerretDB + DocumentDB backend
and return a correct computed result. The ADR-14 spike confirmed all 15
adapter-allowed stages are supported on FerretDB 2.7.0; defensive skip-on-error
hedges are not used. Only `$out` and `$merge` are expected to be blocked by the
adapter allowlist (not by FerretDB itself). Cross-DB `$lookup`
(Location40321) is expected to be rejected by the engine.

#### Scenario: Aggregation pipeline with $match and $group returns computed result
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$match` and `$group` with `$sum`
- **THEN** the response status is 200 and the response body contains an aggregated result with exact numeric totals consistent with the seeded documents

#### Scenario: Aggregation pipeline with $avg returns exact numeric result
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$group` with `$avg` over a numeric field
- **THEN** the response status is 200 and the computed average matches the expected value derived from the seeded documents (mixed-numeric $avg is exact on FerretDB 2.7.0)

#### Scenario: Aggregation pipeline with $sort and $limit returns correctly ordered subset
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$sort` descending and `$limit 3`
- **THEN** the response status is 200 and the response body contains at most 3 documents in descending order by the sort field

#### Scenario: $out stage is rejected by the adapter allowlist
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$out`
- **THEN** the response status is 400 or 403 (adapter allowlist blocks the stage before reaching the engine)

#### Scenario: Cross-DB $lookup is rejected by the engine with Location40321
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing a `$lookup` referencing a collection in a different database
- **THEN** the response status is 400 and the response body contains an error indicating Location40321 or equivalent cross-database lookup rejection

---

### Requirement: Vector-index management via the wired route on FerretDB

The system SHALL support vector-index creation and deletion via
`POST /v1/collections/{name}/vector-indexes` and
`DELETE /v1/collections/{name}/vector-indexes/{indexName}` against the
FerretDB + DocumentDB backend. The DocumentDB engine bundles pgvector 0.8.1.
There is NO `/v1/collections/{name}/indexes` route in the public route catalog.

#### Scenario: Vector-index creation returns HTTP 200
- **WHEN** an authenticated structural_admin request is sent to `POST /v1/collections/{name}/vector-indexes` with a valid vector-index definition
- **THEN** the response status is 200 (or 201) and the index is reflected in subsequent queries using the indexed vector field

#### Scenario: Vector-index deletion returns HTTP 200
- **WHEN** an authenticated structural_admin request is sent to `DELETE /v1/collections/{name}/vector-indexes/{indexName}` for a previously created index
- **THEN** the response status is 200

---

### Requirement: Multi-document transaction returns deterministic unsupported error on FerretDB

The system SHALL, when a multi-document transaction is attempted against the
FerretDB + DocumentDB backend, return a deterministic error indicating
CommandNotFound(59) on `commitTransaction`. No atomic rollback is guaranteed:
`abortTransaction` is a silent no-op on FerretDB 2.7.0.

#### Scenario: commitTransaction returns CommandNotFound(59)
- **WHEN** a client initiates a multi-document transaction and sends `commitTransaction` to the FerretDB-backed document store
- **THEN** the response contains an error code 59 (CommandNotFound) and the request does not succeed as an atomic transaction

#### Scenario: No atomic rollback on abortTransaction
- **WHEN** a client calls `abortTransaction` after writing documents within a transaction against the FerretDB backend
- **THEN** the written documents are not guaranteed to be absent (silent no-op); the spec asserts the absence of an error response, not rollback semantics

---

### Requirement: Per-tenant document-store isolation validated through the data API

The system SHALL enforce that Tenant B cannot read or write documents belonging
to Tenant A's collections, as validated by a cross-tenant Playwright probe using
the canonical A/B tenant fixtures (`tests/e2e/helpers/flows/tenant-fixtures.ts`).
Isolation is enforced by app-layer tenantId scoping; per-database role scoping
is NOT enforced at the FerretDB/DocumentDB layer. All probes MUST exercise the
HTTP data API — direct-to-engine reads are not isolated and are not a valid test
surface.

#### Scenario: Tenant B cannot see Tenant A's documents in a collection listing
- **WHEN** Tenant B sends `GET /v1/collections/{name}/documents` using Tenant B's identity headers, where `{name}` is a collection that Tenant A has written documents into during the same test run
- **THEN** the response body does not contain any document created by Tenant A (app-layer tenantId scoping enforces this at the API level; direct-to-engine reads are not isolation-tested)

#### Scenario: Tenant B query returns no results for Tenant A's documents
- **WHEN** Tenant B sends `POST /v1/collections/{name}/query` with a filter that would match Tenant A's documents, using Tenant B's identity headers
- **THEN** the response status is 200 with an empty result set, or the response status is 403 or 404

#### Scenario: Tenant B cannot leak into Tenant A's documents via create
- **WHEN** Tenant B sends `POST /v1/collections/{name}/documents` targeting the same collection name Tenant A has written into, using Tenant B's identity headers
- **THEN** either the response status is 403 or 404, OR — in Falcone's shared-collection model where collections are not tenant-owned and the `tenantId` field is the boundary — the write succeeds scoped to Tenant B and the created document does NOT appear in Tenant A's view of the collection (app-layer tenantId scoping prevents cross-tenant leakage either way)

---

### Requirement: FerretDB + DocumentDB stack wiring with ENGINE-FIRST readiness ordering

The system SHALL deploy the FerretDB gateway and DocumentDB engine into the
ephemeral E2E namespace via `tests/e2e/stack.sh up` when `E2E_FERRETDB=true` is
set — the existing FerretDB E2E wiring, where the `documentdb` and `ferretdb`
sub-charts of the in-falcone chart are enabled by the FerretDB values overlay and
stack.sh provisions the DocumentDB engine secrets. The DocumentDB engine SHALL be
rolled out to Ready before the FerretDB gateway accepts connections (ENGINE-FIRST
ordering, enforced by the chart's DocumentDB readiness and the `healthy()` gate that
waits on every Deployment and StatefulSet). Both images shall be pre-pulled into the
kind node cache before Helm install. The stack SHALL always delete the ephemeral
namespace on `stack.sh down` via the mandatory EXIT/INT/TERM teardown trap.

#### Scenario: stack.sh up deploys DocumentDB engine before FerretDB gateway accepts connections
- **WHEN** `stack.sh up` is invoked with `E2E_FERRETDB=true`
- **THEN** the DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) StatefulSet rollout completes and reports Ready before the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) is treated as ready (ENGINE-FIRST, enforced by the chart's DocumentDB readiness dependency)

#### Scenario: stack.sh up gates on all pods Ready before test runner is invoked
- **WHEN** `stack.sh up` is invoked with `E2E_FERRETDB=true`
- **THEN** the existing `healthy()` gate does not return until all Deployments and StatefulSets in the ephemeral namespace (including both FerretDB components) report all pods Ready

#### Scenario: stack.sh down always deletes the ephemeral namespace
- **WHEN** `stack.sh down` is invoked (including via the EXIT/INT/TERM trap)
- **THEN** the ephemeral namespace is deleted and no pods remain, regardless of whether the E2E specs passed or failed

---

### Requirement: Per-issue E2E runner path for FerretDB document-store change

The system SHALL provide a per-issue runner path so that
`bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e` executes
`tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts` covering
document CRUD, query, aggregation, vector-index, transaction error, auth, and
cross-tenant isolation scenarios, with the mandatory teardown trap active.
The Mongo change-stream realtime suite (`tests/e2e/realtime/`) is NOT included
in this runner path.

#### Scenario: Per-issue runner executes document-store specs and tears down the namespace
- **WHEN** `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e` is run
- **THEN** only `specs/issues/add-ferretdb-document-store-e2e.spec.ts` (covering all document-store scenario blocks) is executed via Playwright and the ephemeral namespace is torn down after completion regardless of outcome

### Requirement: Data API capability has authoritative architecture documentation for the FerretDB+DocumentDB backend

The system SHALL maintain an authoritative architecture and operations runbook for its active document-store backend (FerretDB+DocumentDB) such that any operator can determine the two-layer component topology, the verified tenancy model (shared backing Postgres DB, app-layer `tenantId` scoping as the authoritative isolation boundary, RLS as hardening, hard isolation requiring a dedicated DocumentDB instance per tier), version-pinning constraints, upgrade order, and known compatibility differences without reading source code or Helm charts.

#### Scenario: Architecture documentation covers the active document-store backend

- **WHEN** an operator needs to understand the document-store backend topology
- **THEN** a documentation file exists in the repository that authoritatively describes the active backend's two-layer design, pinned image pair, upgrade order, the verified tenancy model (shared backing Postgres DB, app-layer `tenantId` scoping authoritative, RLS as hardening, hard isolation via dedicated DocumentDB instance per tier), and known compatibility differences with remediations

#### Scenario: No documentation file misidentifies the active document-store backend

- **WHEN** any repository documentation file references a document-store product by name
- **THEN** it names the currently active backend (FerretDB+DocumentDB) and does not present a superseded backend (MongoDB) as the active store

### Requirement: DDL-created tables MUST be immediately usable via the data API

The system SHALL, when a table is created through the DDL API, grant the api-key data roles (`falcone_service`/`falcone_anon`) the privileges required by the data API and install the tenant RLS policy on that table, so the data API does not return `TABLE_NOT_FOUND` for a table it just created.

#### Scenario: Create-table then CRUD round-trip succeeds for the issuing tenant

- **WHEN** a tenant creates a table via the DDL API and then inserts a row via its service key
- **THEN** the insert succeeds and the table is readable/writable by the issuing tenant (no `TABLE_NOT_FOUND`)

#### Scenario: A newly created table is scoped to the issuing tenant

- **WHEN** a tenant creates a table and another tenant attempts to read it
- **THEN** the other tenant cannot access the table's rows

### Requirement: Document store runs on FerretDB + DocumentDB by chart default; the MongoDB server is removed

The system SHALL default the document-store backend to the FerretDB gateway over the DocumentDB
engine in the umbrella chart (`ferretdb.enabled: true`, `documentdb.enabled: true`,
`mongodb.enabled: false`) and in the kind deploy, with the control-plane's default `MONGO_URI` /
`MONGO_HOST` pointed at the FerretDB gateway. The MongoDB **server** product (the `mongodb`
subchart/alias, `bitnami/mongodb` image, `MONGODB_*` server env, `in-falcone-mongodb` secret, and
replica-set keyfile) SHALL be removed. MongoDB **wire-protocol** compatibility — the `mongodb`
driver, the data-API adapter/executor, the `/v1/collections/*` routes, and the `mongo-cdc-bridge`
(Postgres pgoutput logical replication) — SHALL be retained.

#### Scenario: Chart default deploys FerretDB, not the MongoDB server

- **WHEN** the umbrella chart is rendered with default values
- **THEN** the FerretDB gateway and DocumentDB engine are deployed and the MongoDB server is not,
  and the control-plane's default document-store connection targets the FerretDB gateway

#### Scenario: MongoDB wire-protocol compatibility is preserved

- **WHEN** a client uses a MongoDB driver against the configured `MONGO_URI`
- **THEN** the document-store data API behaves correctly against FerretDB, and no residual reference
  describes a deployed MongoDB **server** product

### Requirement: Postgres data insert contract mismatch

The system SHALL ensure that postgres data insert contract mismatch is corrected: Align the handler with the contract (or vice-versa) + a contract test.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The documented body inserts a row

### Requirement: Executor DDL is confined to the caller's own dedicated database

DDL execution SHALL fail closed (403 `DDL_TARGET_DB_FORBIDDEN`) when the requesting
workspace has no dedicated database provisioned (i.e. the connection would fall back
to the shared/platform database `in_falcone`). The dispatch cross-tenant ownership
check SHALL also apply to routes that target a workspace's resources without a
`/workspaces/` path segment (the DDL routes), using the credential's workspace, so a
caller cannot run DDL on a database owned by another tenant. The executor SHALL set
`GATEWAY_SHARED_SECRET` so client-supplied identity headers are honored only when
accompanied by the matching gateway trust signal.

#### Scenario: DDL on the platform/unprovisioned database is rejected

- **WHEN** a caller issues DDL whose workspace resolves to the shared platform
  database (e.g. an unprovisioned workspace id, including via a forged trust header)
- **THEN** the request is rejected with 403 `DDL_TARGET_DB_FORBIDDEN` and no statement
  runs on `in_falcone`.

#### Scenario: DDL targeting another tenant's workspace is rejected

- **WHEN** a caller issues DDL with a credential/workspace owned by a different tenant
- **THEN** the request is rejected with 403 `CROSS_TENANT_VIOLATION` before any
  connection is made.

#### Scenario: DDL on the caller's own provisioned workspace is unaffected

- **WHEN** the caller issues DDL against its own workspace's dedicated database
- **THEN** the ownership and dedicated-database guards pass and DDL proceeds as before.

