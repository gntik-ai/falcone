## ADDED Requirements

### Requirement: pg_capture_configs uniqueness key MUST be a valid ON CONFLICT arbiter

The system SHALL define the `pg_capture_configs` uniqueness key on `(workspace_id, data_source_ref, schema_name, table_name)` as a NON-deferrable unique constraint, so that `pg-capture-enable`'s `INSERT ... ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name) DO UPDATE` statement is a valid PostgreSQL statement and captures can be created and idempotently re-enabled on PostgreSQL.

#### Scenario: Enabling a PG capture persists against a real Postgres

- **WHEN** a caller with valid gateway identity invokes `pg-capture-enable` (supplying a valid `data_source_ref` and `table_name`) against a Postgres instance provisioned by the service migrations
- **THEN** the `INSERT ... ON CONFLICT` statement executes WITHOUT a "deferrable ... as arbiters" error and the action returns HTTP 201 with the created capture record in the response body

#### Scenario: Re-enabling the same table is idempotent (ON CONFLICT path)

- **WHEN** a caller invokes `pg-capture-enable` twice for the same `(workspace_id, data_source_ref, schema_name, table_name)` combination
- **THEN** the second call resolves via the `ON CONFLICT DO UPDATE` path without a SQL arbiter error and does NOT return HTTP 500
