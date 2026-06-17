## 1. Failing black-box test

- [x] 1.1 Add a black-box test: provision a workspace database, then assert the data API connects to that physical database (not the shared control-plane DB), and that an unprovisioned workspace falls back. — `tests/env/executor/workspace-db-routing.test.mjs` against real Postgres: with a `workspace_databases` row + a `wsdb_*` DB, `registry.withWorkspaceClient` runs `SELECT current_database()` IN the workspace DB; an unprovisioned workspace falls back to the shared DB. RED before routing (the executor always used the shared DSN). Pure resolver coverage in `tests/unit/workspace-dsn-resolver.test.mjs` (rewrite/lookup/fallback/fail-open/cache).

## 2. Fix the saga

- [x] 2.1 Complete the workspace provisioning so a new workspace gets a real, isolated database the data API uses, with no orphaned registry row. — Two parts: (a) per-workspace DSN routing — `apps/control-plane/src/runtime/workspace-dsn-resolver.mjs::createWorkspaceDsnResolver` resolves the workspace's DB from `workspace_databases` and routes the executor connection to it (credential/host preserved, only the database swapped; falls back to the shared DSN), wired in `main.mjs`; (b) auto-provision on create — `deploy/kind/control-plane/b-handlers.mjs::createWorkspace` runs the durable provisioning saga (`runWorkspaceDbProvisionSaga`, extracted from `provisionDatabase`), which creates the DB BEFORE the registry row and compensates on failure, so no orphan row and the workspace gets a real DB.

## 3. Verify

- [x] 3.1 Re-run — confirm a new workspace gets a real, isolated database the data API uses, with no orphaned registry row. — unit 6/6 + real-Postgres routing 2/2 (data connection lands in the workspace DB; unprovisioned falls back). Syntax-checked all changed runtime files.
- [x] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions. — blackbox unaffected (executor/control-plane runtime change); 630/630 from the B-series runs.

- [x] Live gate (required by the operator): built the cp-executor (routing, `0.9.6-d2`) + control-plane (auto-provision, `0.6.3-d2`) images, pushed to the test-cluster-b registry, rolled out the `falcone` namespace, and ran `tests/live-audit/specs/12-workspace-db-provisioning.sh` — **PASS, 0 FAIL**: `POST /v1/tenants/{t}/workspaces` auto-provisions a real `wsdb_*` (physical DB + registry row), the data API DDL+insert+read land in that workspace DB (table ABSENT in shared `in_falcone` → routing proven), and B1's FORCE RLS is active inside `wsdb_*` (unscoped read hidden, tenant-scoped read sees the row). Self-cleaning (tenant/workspace delete is D1).
