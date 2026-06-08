# change-data-capture Specification

## Purpose
TBD - created by archiving change fix-cdc-capture-verify-jwt-identity. Update Purpose after archive.
## Requirements
### Requirement: CDC action identity must derive from gateway-trusted headers only

The system SHALL reject any CDC capture action request whose `x-tenant-id` or `x-workspace-id` header is absent or empty, returning HTTP 401 UNAUTHORIZED, regardless of any Authorization Bearer token content.

#### Scenario: Missing gateway identity headers are rejected

- **WHEN** a caller invokes a CDC capture action (pg-capture-enable, pg-capture-disable, pg-capture-list, pg-capture-tenant-summary, or their mongo-* counterparts) without the gateway-injected `x-tenant-id` and `x-workspace-id` headers
- **THEN** the action returns HTTP 401 with body `{ "code": "UNAUTHORIZED" }` and performs no database read or write

### Requirement: Forged unsigned JWT payload MUST NOT grant cross-tenant capture access

The system SHALL derive tenant scope exclusively from gateway-injected headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`) and SHALL NOT parse or trust any fields from the Authorization Bearer token payload for identity or tenant scoping in CDC capture actions.

#### Scenario: Forged tenant identity in unsigned JWT is ignored (bbx-cdc-forged-tenant)

- **WHEN** a caller presents `Authorization: Bearer <base64url({"tenant_id":"ten_VICTIM","workspace_id":"wrk_VICTIM","sub":"attacker"})>` (an unsigned, unverified token) to `pg-capture-enable` along with valid `data_source_ref` and `table_name`, and the gateway headers carry the caller's own `x-tenant-id`
- **THEN** the action does NOT create a capture record under `ten_VICTIM`, does NOT return HTTP 201 scoped to the victim tenant, and the forged `tenant_id` value in the token payload is never used as the data-scoping identity

### Requirement: CDC capture actions MUST scope all data operations to the gateway-provided tenant

The system SHALL use the `x-tenant-id` and `x-workspace-id` header values — not any Authorization token field — as the `tenant_id` and `workspace_id` for all database creates, reads, and writes performed by CDC capture actions.

#### Scenario: Create is scoped to the gateway-provided tenant identity

- **WHEN** a caller with valid gateway headers (`x-tenant-id: ten_A`, `x-workspace-id: wrk_A`) successfully invokes `pg-capture-enable`
- **THEN** the created capture record has `tenant_id = ten_A` and `workspace_id = wrk_A`, and the response body reflects those values

### Requirement: pg_capture_configs uniqueness key MUST be a valid ON CONFLICT arbiter

The system SHALL define the `pg_capture_configs` uniqueness key on `(workspace_id, data_source_ref, schema_name, table_name)` as a NON-deferrable unique constraint, so that `pg-capture-enable`'s `INSERT ... ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name) DO UPDATE` statement is a valid PostgreSQL statement and captures can be created and idempotently re-enabled on PostgreSQL.

#### Scenario: Enabling a PG capture persists against a real Postgres

- **WHEN** a caller with valid gateway identity invokes `pg-capture-enable` (supplying a valid `data_source_ref` and `table_name`) against a Postgres instance provisioned by the service migrations
- **THEN** the `INSERT ... ON CONFLICT` statement executes WITHOUT a "deferrable ... as arbiters" error and the action returns HTTP 201 with the created capture record in the response body

#### Scenario: Re-enabling the same table is idempotent (ON CONFLICT path)

- **WHEN** a caller invokes `pg-capture-enable` twice for the same `(workspace_id, data_source_ref, schema_name, table_name)` combination
- **THEN** the second call resolves via the `ON CONFLICT DO UPDATE` path without a SQL arbiter error and does NOT return HTTP 500

