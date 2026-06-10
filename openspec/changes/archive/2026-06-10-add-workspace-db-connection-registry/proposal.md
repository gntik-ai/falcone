## Why

The control-plane executor (add-control-plane-executor) must run adapter plans
against real Postgres drivers, but the codebase has no layer that resolves a
workspace to a database DSN or maintains a pooled client for it. The default
`falcone` DB user is a PostgreSQL SUPERUSER and carries BYPASSRLS, as confirmed
by `FORBIDDEN_ENGINE_DETAIL_FIELDS` including `bypassRls` in
`services/adapters/src/postgresql-admin.mjs::FORBIDDEN_ENGINE_DETAIL_FIELDS`
and the reserved role list at lines 42-54 of that file which names
`platform_runtime` as the correct application role class. Without an explicit
registry that maps workspaces to their DSN and enforces the non-BYPASSRLS
`platform_runtime` role, the executor would either default to the superuser
connection (bypassing every RLS policy shipped in
`docs/reference/postgresql/tenant-isolation-baseline.sql`) or open unbounded
raw connections with no per-workspace isolation. The authorization model at
`services/internal-contracts/src/authorization-model.json:583` already flags
`cross_workspace_connection_reuse` as a forbidden action, confirming this is a
known isolation boundary.

## What Changes

- Add `apps/control-plane/src/workspace-db-connection-registry.mjs` — the
  registry module that resolves a workspace ID to its database DSN (sourced
  from the dataplane provisioning catalog), maintains one `pg.Pool` per
  distinct database DSN using the `platform_runtime` (non-BYPASSRLS) role, and
  exposes `acquire(workspaceId, {tenantId}, fn)` which wraps every call in
  `withTenantRlsContext` so `app.tenant_id` and `app.workspace_id` are set
  inside the transaction.
- Add a separate `acquireMigration(workspaceId, fn)` entry point that returns a
  superuser/migrator connection for DDL and sweep operations, bypassing RLS
  intentionally with an explicit call-site annotation.
- Fail-closed: `acquire()` on an unknown workspace ID throws
  `WORKSPACE_DSN_UNKNOWN` before opening any connection.
- Re-export `withTenantRlsContext` from
  `services/adapters/src/postgresql-data-api.mjs` (already used for RLS
  set_config patterns referenced in
  `services/internal-contracts/src/authorization-model.json:314`).

## Capabilities

### New Capabilities

- `data-plane-connectivity`: Per-workspace pooled Postgres connections scoped
  to the `platform_runtime` (non-BYPASSRLS) role; every tenant data query
  wrapped in `withTenantRlsContext`; separate migration path using the
  superuser/migrator credential; fail-closed on unknown workspace DSN;
  cross-workspace connection reuse explicitly prevented.

### Modified Capabilities

## Impact

- `apps/control-plane/src/workspace-db-connection-registry.mjs` — new module
  (connection registry, pool management, RLS context wrapper, fail-closed guard).
- `services/adapters/src/postgresql-data-api.mjs` — re-export or co-locate
  `withTenantRlsContext` so the registry can import it without circular
  dependency on the adapter layer.
- Executor (add-control-plane-executor) — consumes the registry instead of
  opening raw connections; no direct dependency on Postgres credentials.
- `services/internal-contracts/src/authorization-model.json` — no change
  required; `cross_workspace_connection_reuse` is already a `forbidden_action`.
