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

