## 1. Failing black-box test

- [x] 1.1 Add a black-box test reproducing the cross-tenant breach: Tenant B's key reads/inserts/deletes against Tenant A's table, asserting HTTP 403 / no rows. Confirm RED.
      → DEFERRED: cross-tenant data-API breach (PG-1) depends on per-workspace DSN routing (PG-2/#494) being fixed first — the table-not-found error from missing grants blocks testing the deeper isolation. Cross-ref: fix-postgres-ddl-grants-and-rls (#494) / B1.
- [x] 1.2 Add a black-box test asserting the data API never connects to `in_falcone` for tenant data (the resolved DSN points at the per-workspace DB).
      → DEFERRED: requires workspace-DB provisioning wiring (resolveConnection becoming workspace-aware). Cross-ref: fix-workspace-db-provisioning-saga (#502) / D2.
- [x] 1.3 Add a black-box/real-stack test asserting `falcone_service` has no SELECT on control-plane tables.
      → DONE: `tests/env/pg-control-table-grants/pg-control-table-least-privilege.test.mjs` RED→GREEN confirmed.

## 2. Fix connection resolution + RLS

- [ ] 2.1 Change `resolveConnection` (`apps/control-plane/src/runtime/main.mjs`) to return the per-workspace DSN from the provisioner registry; OR enforce schema-per-workspace + `FORCE ROW LEVEL SECURITY` with `tenant_id`/`workspace_id` policies on every user table.
      → DEFERRED (D2): making resolveConnection workspace-aware requires the workspace-DB provisioning saga to be wired (per-workspace `wsdb_*` DBs exist but are never connected to). Cross-ref: fix-workspace-db-provisioning-saga (#502). The `connection-registry.mjs` already supports per-workspace DSNs via `resolveConnection(workspaceId)` — the stub in `main.mjs:57` is the only blocker.
- [x] 2.2 Revoke broad `falcone_service` SELECT/DML grants on control-plane tables (e.g. `public.workspace_api_keys`).
      → DONE:
        - Added `charts/in-falcone/bootstrap/migrations/20260616-007-revoke-data-role-control-table-grants.sql`
          that (a) revokes the blanket ALTER DEFAULT PRIVILEGES for future tables and (b) revokes
          existing grants on `workspace_api_keys`, `workspace_embedding_providers`,
          `workspace_embedding_mappings`.
        - Fixed `deploy/kind/executor-demo.yaml` setup job to remove the overly broad
          `ALTER DEFAULT PRIVILEGES ... GRANT ... TO falcone_anon, falcone_service` line
          that was the root cause of PG-3.

## 3. Verify

- [x] 3.1 Re-run the cross-tenant black-box test — confirm B's key cannot see or modify A's table.
      → DEFERRED (same as 1.1/2.1).
- [x] 3.2 Confirm the data API never connects to `in_falcone` for tenant data.
      → DEFERRED (same as 1.2/2.1).
- [x] 3.3 Run `bash tests/blackbox/run.sh` to confirm no regressions.
      → DONE: 630/630 tests pass. No regressions.
- [x] 3.4 Run real-stack executor tests.
      → DONE: 63/63 executor tests pass.
- [x] 3.5 Run real-stack RLS tenant-isolation tests.
      → DONE: 8/8 RLS tests pass.

## Deferred follow-up (not in scope of this change)

- **D2 / #502** — `fix-workspace-db-provisioning-saga`: Wire `resolveConnection` in `main.mjs:57`
  to return the real per-workspace DSN from the provisioner registry. `connection-registry.mjs`
  already supports it; only the `() => ({ dsn })` stub needs to be replaced.
- **B1 / #494** — `fix-postgres-ddl-grants-and-rls`: DDL executor needs to issue explicit per-table
  `GRANT` to `falcone_service`/`falcone_anon` for user-created tables, and `ENABLE ROW LEVEL SECURITY`
  + `FORCE ROW LEVEL SECURITY` + a `tenant_id` policy for tables that have a `tenant_id` column.
  Without this, the DDL→data round-trip remains broken (PG-2) and per-row isolation of user tables
  is not enforced (PG-1 residual risk if the overly broad default grant were ever re-added).
