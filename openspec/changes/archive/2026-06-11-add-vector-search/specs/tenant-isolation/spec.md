## ADDED Requirements

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
