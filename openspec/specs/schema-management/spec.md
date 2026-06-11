# schema-management Specification

## Purpose
TBD - created by archiving change add-postgres-ddl-execute. Update Purpose after archive.
## Requirements
### Requirement: DDL plans are executed transactionally against the workspace database

The system SHALL accept a validated DDL plan produced by `buildPostgresAdminAdapterCall`
(`services/adapters/src/postgresql-admin.mjs`) and execute its `ddlPlan.statements`
array inside a single managed database transaction against the workspace's registered
Postgres connection, so that structural changes (create/alter/drop for schema, table,
column, index, constraint, view, materialized view, function, policy, extension, grant)
are actually applied rather than returned as preview-only artifacts.

#### Scenario: Table created via DDL plan becomes queryable

- **WHEN** a caller submits a `POST /v1/postgres/databases/{db}/schemas/{schema}/tables`
  request with a valid table definition and `executionMode: "execute"`
- **THEN** the executor runs the `CREATE TABLE` statement from `ddlPlan.statements`,
  the response carries `executionMode: "execute"` with no error, and a subsequent
  `\d` or `SELECT` against the workspace database confirms the table exists and is
  queryable

#### Scenario: Column added to existing table is queryable

- **WHEN** a caller submits a `POST /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns`
  request with a valid column definition and `executionMode: "execute"`
- **THEN** the executor runs the `ALTER TABLE … ADD COLUMN` statement, and the new
  column is present and accessible in subsequent queries against that table

#### Scenario: Index created on an existing table is visible in the catalog

- **WHEN** a caller submits a `POST /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/indexes`
  request with a valid index definition and `executionMode: "execute"`
- **THEN** the `CREATE INDEX` statement executes without error and the index appears
  in `pg_indexes` for that table

### Requirement: Invalid DDL is rolled back and returns a sanitized error

The system SHALL roll back the database transaction and return a sanitized error
response (no stack trace, no raw SQL context, no internal server state) whenever any
statement in `ddlPlan.statements` raises a Postgres error, so that partial schema
changes cannot leave the workspace database in an inconsistent state and internal
implementation details are not exposed to callers.

#### Scenario: Invalid DDL is rolled back — table does not exist after failure

- **WHEN** the executor runs a DDL plan that contains an invalid statement (e.g. a
  column type unknown to the engine or a duplicate object name) and Postgres raises
  an error
- **THEN** the transaction is rolled back in full, the response has a 4xx or 5xx
  status carrying only a sanitized error object (no stack trace, no internal SQL
  fragment beyond a safe summary), and none of the objects that would have been
  created by the plan exist in the workspace database

#### Scenario: Sanitized error omits internal implementation details

- **WHEN** the executor catches a Postgres exception during DDL execution
- **THEN** the error response body does not include a Node.js stack trace, raw `pg`
  driver error properties, or the literal DDL statement text that caused the failure

### Requirement: Raw-SQL DDL is blocked for non-eligible plans

The system SHALL deny execution of raw SQL statements via
`/v1/postgres/workspaces/{id}/admin/{db}/sql` to tenants whose plan does not carry
the `postgres.admin_sql` flag (`pln_01regulated` and `pln_01enterprise` are the only
eligible plans per `POSTGRES_ADMIN_SQL_PLAN_FLAGS_BY_PLAN` in
`services/adapters/src/postgresql-admin.mjs`), so that arbitrary DDL execution
remains a gated capability.

#### Scenario: Raw-SQL request from non-eligible plan is rejected

- **WHEN** a request reaches `POST /v1/postgres/workspaces/{id}/admin/{db}/sql`
  carrying a `planId` of `pln_01starter` or `pln_01growth`
- **THEN** the system rejects the request with a 403-class response indicating the
  plan does not carry the `postgres.admin_sql` flag, and no SQL statement is executed

#### Scenario: Raw-SQL request from eligible plan proceeds

- **WHEN** a request reaches `POST /v1/postgres/workspaces/{id}/admin/{db}/sql`
  carrying a `planId` of `pln_01regulated` or `pln_01enterprise` with a valid
  statement that passes the forbidden-pattern checks (`SET ROLE`, `ALTER SYSTEM`,
  `COPY … PROGRAM`, transaction-control statements are blocked by
  `services/adapters/src/postgresql-admin.mjs:877-882`)
- **THEN** the statement is executed and the response reflects the execution outcome

### Requirement: RLS policy creation enables row-level security on the target table

The system SHALL, when executing a policy-create DDL plan that carries the
`rlsEnabled` flag, issue both the `CREATE POLICY` statement rendered by
`renderPolicyStatement` (`services/adapters/src/postgresql-governance-admin.mjs:191`)
and the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statement within the same
transaction, so that the policy is immediately active and no subsequent manual step
is required to enforce it.

#### Scenario: RLS policy created and row-level security enabled atomically

- **WHEN** a caller submits a request to create an RLS policy on a table with
  `rlsEnabled: true` and `executionMode: "execute"`
- **THEN** the executor issues both `CREATE POLICY … ON …` and
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in a single transaction, the response
  confirms execution success, and querying `pg_policies` and `pg_class.relrowsecurity`
  shows the policy is active and RLS is enabled on the table

#### Scenario: Policy body is confined to the bounded declarative subset

- **WHEN** a policy definition's `USING` or `WITH CHECK` expression includes DDL,
  grants, comments, or statement chaining (rejected by `postgresql-governance-admin.mjs:187`)
- **THEN** the plan builder rejects the request before any SQL is sent to the database,
  returning a 4xx validation error that identifies the offending clause

### Requirement: Vector field type with mandatory dimension is accepted by the DDL surface

The system SHALL accept `dataType: "vector"` (rendered as `vector(N)` in SQL) as a
valid column type in structural DDL requests, require a positive integer `dimension`
attribute in range 1-16000, and reject the column definition with HTTP 422 if
`dimension` is absent or out of range. This builds on the existing column type pipeline
in `apps/control-plane/src/runtime/postgres-ddl-executor.mjs::buildDdlPlan` and the
structural admin plan builder.

#### Scenario: Vector column DDL with valid dimension is accepted

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and `dimension: 768`
- **THEN** the DDL plan contains `ALTER TABLE … ADD COLUMN … vector(768)`, the executor
  runs it, and the column is present in `information_schema.columns` for that table

#### Scenario: Vector column DDL without dimension is rejected before SQL

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and no `dimension` field
- **THEN** the system returns HTTP 422 with an error identifying `dimension` as
  required, and no SQL statement is executed against the database

#### Scenario: Vector column DDL with dimension out of range is rejected

- **WHEN** a structural admin submits a column creation request with
  `dataType: "vector"` and `dimension: 0` (or greater than 16000)
- **THEN** the system returns HTTP 422 before issuing any DDL

### Requirement: Vector index declaration (HNSW/IVFFlat) is accepted by the DDL surface

The system SHALL accept a vector index declaration on a column of type `vector(N)`,
with `indexType` of `hnsw` (default) or `ivfflat`, and a `metric` of `cosine`
(default, opclass `vector_cosine_ops`), `l2` (`vector_l2_ops`), or `inner_product`
(`vector_ip_ops`). The DDL executor SHALL render and execute the corresponding
`CREATE INDEX … USING hnsw/ivfflat` statement, following the existing index-creation
path in `apps/control-plane/src/runtime/postgres-ddl-executor.mjs`.

#### Scenario: HNSW cosine index DDL is rendered correctly

- **WHEN** a structural admin submits a vector index request with defaults (no
  `indexType`, no `metric`)
- **THEN** the DDL plan contains
  `CREATE INDEX … ON … USING hnsw ("<column>" vector_cosine_ops)` and the index
  appears in `pg_indexes` after execution

#### Scenario: IVFFlat inner-product index DDL is rendered correctly

- **WHEN** a structural admin submits a vector index request with
  `indexType: "ivfflat"` and `metric: "inner_product"`
- **THEN** the DDL plan contains
  `CREATE INDEX … ON … USING ivfflat ("<column>" vector_ip_ops)`

#### Scenario: Index on non-vector column is rejected

- **WHEN** a structural admin requests a vector index on a column whose declared
  `dataType` is not `vector`
- **THEN** the system rejects the request with HTTP 422 before issuing any SQL

