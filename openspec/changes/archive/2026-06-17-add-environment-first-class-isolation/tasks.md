## 1. Failing black-box test

- [x] 1.1 Add a test: a tenant/project holds multiple environments (prod + staging), each with an isolated database; list them. — `tests/env/executor/tenant-environments.test.mjs` (real Postgres): `environment` persists on workspace create + reads back; defaults to `dev`; `listTenantEnvironments` groups a tenant's workspaces by environment, each with its own (distinct) `wsdb_*` database. RED before: no `environment` column (it returned null).

## 2. Add environment isolation

- [x] 2.1 First-class `environment` on the workspace create flow. — `environment` column on `workspaces` (CREATE + idempotent ALTER), carried on `workspace_databases`; `createWorkspace` accepts + validates it against `ENVIRONMENT_CATALOG` (dev/staging/prod/sandbox/preview; default dev; invalid → 400 INVALID_ENVIRONMENT) and persists it; `workspaceOut` + `getWorkspace`/`listWorkspaces` return it. `GET /v1/tenants/{t}/environments` (`listEnvironments` + `store.listTenantEnvironments`) lists the tenant's environments with their workspaces/DBs.
- [x] 2.2 Isolated resource set per environment. — each workspace (environment) gets its own provisioned `wsdb_*` database via the D2 saga; the `environment` is carried on the registry row, so prod/staging/dev under one tenant have distinct, isolated databases (proven prod-DB ≠ staging-DB).

## 3. Verify

- [x] 3.1 Re-run — multiple isolated environments per project work. — env store test 3/3. **LIVE on test-cluster-b** (control-plane `0.6.3-d3`): created prod + staging workspaces under a tenant — `environment` persisted on each, `GET …/environments` lists both with distinct isolated databases (`wsdb_…_prod` ≠ `wsdb_…_stg`), and an out-of-catalog environment is rejected with 400.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — no regressions (control-plane runtime change; additive column/field/route).
