# workflows — spec delta for fix-flows-worker-pg-env-and-search-attrs

## ADDED Requirements

### Requirement: The flows worker has Postgres env and Temporal search attributes are registered

The workflow-worker deployment SHALL carry Postgres connection env (`PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, and `PGDATABASE` pointing at the database that holds the
`workspace_databases` registry, i.e. `in_falcone`), so the `db.query` activity resolves
the workspace database instead of falling back to localhost. The flows bring-up SHALL
register the five custom Temporal search attributes (`tenantId`, `workspaceId`,
`flowId`, `flowVersion`, `triggerType`, all Keyword) before workflows run.

#### Scenario: db.query activity reaches the workspace database

- **WHEN** a flow runs a `db.query` activity
- **THEN** the worker connects with its configured PG env and returns rows (no
  `UPSTREAM_UNAVAILABLE` from a localhost fallback).

#### Scenario: flow execution does not fail on a missing search attribute

- **WHEN** a flow is started (manually or via a trigger) on a freshly created dev
  Temporal namespace
- **THEN** the five custom search attributes are registered, so the concurrency
  pre-flight (`workflow.list` filtered by them) succeeds instead of 500ing.
