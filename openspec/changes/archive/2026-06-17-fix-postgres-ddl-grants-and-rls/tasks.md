## 1. Failing black-box test

- [x] 1.1 Add a black-box test: create a table via the DDL API, then insert via the service key, asserting success (not 404 TABLE_NOT_FOUND). Confirm RED. — `tests/env/executor/postgres-ddl-grants-rls.test.mjs` ("create→CRUD round-trip succeeds"); RED confirmed with the fix reverted (insert → `TABLE_NOT_FOUND 404`). Deterministic plan coverage in `tests/unit/postgres-ddl-table-isolation.test.mjs`.
- [x] 1.2 Add a black-box test asserting the created table CRUD works only for the issuing tenant. — same env file ("a newly created table is scoped to the issuing tenant"): tenant B reads/writes the same physical table via its own service identity and sees none of A's rows, and vice versa.

## 2. Fix DDL grants + RLS

- [x] 2.1 In the DDL/provisioning path, emit GRANTs to the api-key roles (`falcone_service`/`falcone_anon`) on each created table. — `apps/control-plane/src/runtime/postgres-ddl-executor.mjs::tableIsolationStatements` appends `GRANT USAGE ON SCHEMA` + `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE` to both roles, wired into `buildDdlPlan` for `table`+`create`, run in the same transactional DDL unit on the admin connection.
- [x] 2.2 Install the tenant RLS policy on the new table as part of creation (ties into A3). — same path ensures a `tenant_id` column exists (`ADD COLUMN IF NOT EXISTS … DEFAULT current_setting('app.tenant_id', true)`), then `ENABLE`/`FORCE ROW LEVEL SECURITY` + a `<table>_tenant_isolation` policy keyed on `tenant_id = current_setting('app.tenant_id', true)` — mirroring the data executor's policy and the connection registry's `SET LOCAL`/GUC context, so even a forgotten adapter predicate cannot cross tenants.

## 3. Verify

- [x] 3.1 Re-run the round-trip black-box test — confirm create-then-CRUD works for the issuing tenant. — `tests/env/executor/postgres-ddl-grants-rls.test.mjs` GREEN (3/3) against real Postgres; full executor suite 66/66 (was 63; +3), incl. the cross-tenant isolation probe. Touched env tests (`postgres-ddl-executor`, `app-api-keys-rls`) updated to ensure-create the now-shared `falcone_service`/`falcone_anon` roles race-safely (`tests/env/executor/data-api-roles.mjs`).
- [x] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions. — 630/630 pass; unit + adapters (postgres-admin) 15/15.
