# tenant-isolation Specification

## Purpose
TBD - created by archiving change add-rls-enforced-tenant-migrations. Update Purpose after archive.
## Requirements
### Requirement: RLS enabled on all tenant-scoped service tables

The system SHALL enable Row-Level Security (`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`) on every tenant-scoped table in the webhook-engine, scheduling-engine, realtime-gateway, and provisioning-orchestrator services.

#### Scenario: Direct query without tenant context is blocked by RLS

- **WHEN** a database session issues `SELECT * FROM scheduled_jobs` without setting `app.tenant_id`
- **THEN** the database MUST return zero rows (policy denies access) rather than returning rows from all tenants

#### Scenario: Query with correct tenant context returns only that tenant's rows

- **WHEN** a database session sets `app.tenant_id = 'ten_A'` and issues `SELECT * FROM scheduled_jobs`
- **THEN** the database MUST return only rows where `tenant_id = 'ten_A'`

### Requirement: RLS policies block cross-tenant leakage even when application predicate is omitted

The system SHALL ensure that omitting a `WHERE tenant_id = $1` predicate in an application query does not result in cross-tenant data disclosure, because the RLS policy enforces the same constraint at the database level.

#### Scenario: Forgotten WHERE tenant_id predicate is blocked by RLS policy

- **WHEN** an application query omits the `tenant_id` predicate on a table that has an RLS policy bound to `current_setting('app.tenant_id')`
- **THEN** the database MUST silently filter the result set to only rows matching the session's `app.tenant_id`, equivalent to having included the predicate

#### Scenario: Cross-tenant probe is blocked end-to-end

- **WHEN** tenant A's session (with `app.tenant_id = 'ten_A'`) attempts to read a row known to belong to tenant B
- **THEN** the query MUST return zero rows and MUST NOT expose any tenant-B data

### Requirement: Legitimate superuser and sweep paths continue to function

The system SHALL allow designated superuser / migration-runner sessions to bypass RLS via `BYPASSRLS` privilege or an explicit wildcard sentinel setting, so orphan-sweep and cross-tenant administrative actions are not broken.

#### Scenario: Superuser session with BYPASSRLS reads all tenant rows

- **WHEN** a database session with the `BYPASSRLS` privilege (or the migration runner role) issues an unscoped query
- **THEN** the database MUST return all rows across all tenants, unfiltered by the RLS policy

#### Scenario: Normal application role cannot bypass RLS

- **WHEN** an application service role (without `BYPASSRLS`) issues a query without setting `app.tenant_id`
- **THEN** the database MUST return zero rows and MUST NOT expose any tenant data

### Requirement: KNN query result set is bounded to the authenticated tenant by RLS

The system SHALL execute every KNN similarity search under the non-BYPASSRLS
`falcone_app` application role (consistent with the existing RLS architecture described
in the `tenant-isolation` spec) and SHALL ensure that the RLS policy on the vector
table filters candidate rows BEFORE the pgvector distance ranking step, so that a
tenant's KNN query NEVER returns vectors belonging to a different tenant even if those
vectors are numerically closer to the query than any of the tenant's own vectors.

#### Scenario: Cross-tenant KNN probe returns only tenant-A rows

- **WHEN** tenant A and tenant B each have rows in the same Postgres table with a
  `vector` column, and tenant A issues a KNN search whose query vector is geometrically
  nearest to a row owned by tenant B
- **THEN** the response contains only rows whose `tenant_id` matches tenant A;
  no tenant B row appears in the response, and the `distance` values reflect ranking
  among tenant A's rows exclusively

#### Scenario: KNN query executed under non-BYPASSRLS role cannot see other-tenant rows

- **WHEN** the KNN plan executor acquires the database connection under the
  non-BYPASSRLS `falcone_app` role and issues
  `SELECT … ORDER BY embedding <=> $queryVector LIMIT k`
  without an explicit `WHERE tenant_id = $1` predicate
- **THEN** the active RLS policy (bound to `current_setting('app.current_tenant_id')`)
  prevents any row from another tenant from entering the candidate set, and the
  result set contains at most k rows all belonging to the session tenant

#### Scenario: Absent tenant session setting produces zero rows rather than a cross-tenant leak

- **WHEN** the `app.current_tenant_id` session variable is unset or empty at the time
  a KNN query is executed under the application role
- **THEN** the RLS policy returns zero rows, consistent with the existing RLS
  fail-closed policy described in the tenant-isolation spec, and no data from any
  tenant is disclosed

