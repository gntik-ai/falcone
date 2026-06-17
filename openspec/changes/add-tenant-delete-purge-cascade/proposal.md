Tracking issue: gntik-ai/falcone#501

## Why

`DELETE /v1/tenants/{t}`, `POST /v1/tenants/{t}/purge` (and deactivate/suspend/archive) all return **404 NO_ROUTE**. There is no way to offboard a tenant or clean up its resources, so tenants, workspaces, registry rows, async-op rows and any provisioned Postgres/realm/bucket/topic resources accumulate as **orphans**. This fails audit priority #5 ("deletion with cascading cleanup, no orphaned cross-tenant data") and is both a lifecycle gap and an isolation concern.

Live proof (`tests/live-audit/evidence/11-provisioning-lifecycle.md`): an orphaned `workspace_databases` row (`wsdb_laprov909_prod`) with no backing DB; probe tenants had to be removed by direct SQL.

## What Changes

- Wire tenant delete and purge with a cascading saga that removes every owned resource (workspaces, databases, realms, buckets, topics, keys, registry rows, async-op rows).

## Capabilities

### New Capabilities

- `tenant-lifecycle`: Tenant deletion/purge removes every resource a tenant owns, leaving no orphaned rows, databases, realms, buckets, or topics.

### Modified Capabilities

## Impact

- New `DELETE /v1/tenants/{t}` and `POST /v1/tenants/{t}/purge` routes plus a cascading cleanup saga.
- Ties into D2 (`fix-workspace-db-provisioning-saga`).
