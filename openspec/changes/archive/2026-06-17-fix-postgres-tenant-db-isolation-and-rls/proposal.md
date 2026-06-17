Tracking issue: gntik-ai/falcone#490

## Why

`apps/control-plane/src/runtime/main.mjs:57` defines `resolveConnection = () => ({ dsn })`, ignoring `workspaceId` — so **all workspaces share `in_falcone`** (the control-plane metadata DB) and the provisioned `wsdb_*` databases are orphaned. User tables created via the DDL API have **no RLS** and are owned by `falcone`; the shared `falcone_service` role can read across tenants.

Live proof (`tests/live-audit/specs/03-postgres-isolation.sh`): Tenant B read `TENANT-A-CONFIDENTIAL`, inserted a row, and **deleted** A's row, all via B's own key; the response reported `access:{rlsEnforced:false,reason:"grant_only"}`. `falcone_service` has SELECT on `public.workspace_api_keys` (all tenants). (Evidence: `tests/live-audit/evidence/03-postgres-and-isolation.md`.)

## What Changes

- Make `resolveConnection` return the real per-workspace DSN from the data-plane provisioner registry (which already supports it) so tenant data never lands in `in_falcone`; OR, if staying single-DB, enforce schema-per-workspace plus `FORCE ROW LEVEL SECURITY` with `tenant_id`/`workspace_id` policies on every table.
- Revoke the broad `falcone_service` grants on control-plane tables (e.g. `public.workspace_api_keys`).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-isolation`: Postgres data-plane connections are scoped per workspace and user tables are protected by RLS, so a tenant credential cannot read or modify another tenant's data.

## Impact

- `apps/control-plane/src/runtime/main.mjs:57` (`resolveConnection`).
- Postgres role grants on control-plane tables (`falcone_service`).
- Ties into B1 (`fix-postgres-ddl-grants-and-rls`) and D2 (`fix-workspace-db-provisioning-saga`).
