Tracking issue: gntik-ai/falcone#502

## Why

`POST /v1/workspaces` creates a `workspace_databases` registry row but the backing `wsdb_*` Postgres database is never created — only the two long-lived demo workspaces have real DBs. The provisioning saga does not complete, so new workspaces get a registry row with no physical database. This ties into A3/B1 (the runtime ignores per-workspace DBs anyway).

Live proof (`tests/live-audit/evidence/11-provisioning-lifecycle.md`): `wsdb_laprov909_prod` had a registry row but no backing physical database.

## What Changes

- Complete the workspace provisioning saga so that creating a workspace actually creates its `wsdb_*` Postgres database (and any other backing resources the registry row promises).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-provisioning`: Creating a workspace provisions a real, isolated database that the data API connects to, with no orphaned registry rows.

## Impact

- Workspace provisioning saga (`async_operations`/`async_operation_transitions`).
- Ties into A3 (`fix-postgres-tenant-db-isolation-and-rls`) and B1 (`fix-postgres-ddl-grants-and-rls`).
