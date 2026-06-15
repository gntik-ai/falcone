## MODIFIED Requirements

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

## ADDED Requirements

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
