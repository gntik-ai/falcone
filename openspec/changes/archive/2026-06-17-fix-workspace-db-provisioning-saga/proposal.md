Tracking issue: gntik-ai/falcone#502

## Why

`POST /v1/workspaces` creates a `workspace_databases` registry row but the backing `wsdb_*` Postgres database is never created — only the two long-lived demo workspaces have real DBs. The provisioning saga does not complete, so new workspaces get a registry row with no physical database. This ties into A3/B1 (the runtime ignores per-workspace DBs anyway).

Live proof (`tests/live-audit/evidence/11-provisioning-lifecycle.md`): `wsdb_laprov909_prod` had a registry row but no backing physical database.

## What Changes

- Corrected scope after reading the code: the provisioning saga and `provisionWorkspaceDatabase` already create the physical `wsdb_*` database correctly (DB **before** the registry row, with compensation — so no orphan row), and the live `falcone` role has `CREATEDB`. The real gaps are: (1) the executor's `resolveConnection` ignored `workspaceId` and always used the shared `in_falcone` DB (A3's explicitly-deferred per-workspace-DSN routing), so provisioned databases were never used; and (2) workspace creation never triggered provisioning (it was a separate endpoint), so workspaces had no database at all.
- Route each data-plane connection to the requesting workspace's own `wsdb_*` database via the `workspace_databases` registry, falling back to the shared DSN when none exists (`apps/control-plane/src/runtime/workspace-dsn-resolver.mjs`).
- Auto-provision the backing database as part of `POST /v1/tenants/{t}/workspaces`, reusing the durable saga (DB-before-row, compensated) so a new workspace gets a real database and no orphan registry row.

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-provisioning`: Creating a workspace provisions a real, isolated database that the data API connects to, with no orphaned registry rows.

## Impact

- Workspace provisioning saga (`async_operations`/`async_operation_transitions`).
- Ties into A3 (`fix-postgres-tenant-db-isolation-and-rls`) and B1 (`fix-postgres-ddl-grants-and-rls`).
