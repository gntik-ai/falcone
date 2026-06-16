## 1. Failing black-box test

- [ ] 1.1 Add a black-box test reproducing the cross-tenant breach: Tenant B's key reads/inserts/deletes against Tenant A's table, asserting HTTP 403 / no rows. Confirm RED.
- [ ] 1.2 Add a black-box test asserting the data API never connects to `in_falcone` for tenant data (the resolved DSN points at the per-workspace DB).
- [ ] 1.3 Add a black-box test asserting `falcone_service` has no SELECT on control-plane tables.

## 2. Fix connection resolution + RLS

- [ ] 2.1 Change `resolveConnection` (`apps/control-plane/src/runtime/main.mjs`) to return the per-workspace DSN from the provisioner registry; OR enforce schema-per-workspace + `FORCE ROW LEVEL SECURITY` with `tenant_id`/`workspace_id` policies on every user table.
- [ ] 2.2 Revoke broad `falcone_service` SELECT/DML grants on control-plane tables (e.g. `public.workspace_api_keys`).

## 3. Verify

- [ ] 3.1 Re-run the cross-tenant black-box test — confirm B's key cannot see or modify A's table.
- [ ] 3.2 Confirm the data API never connects to `in_falcone` for tenant data.
- [ ] 3.3 Run `bash tests/blackbox/run.sh` to confirm no regressions.
