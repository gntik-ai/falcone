# Evidence — Tenant/project/environment provisioning lifecycle (live)

(The delegated agent stalled mid-run; these results were completed/confirmed directly by the driver
and all probe tenants it created were cleaned up — final tenant count back to the original 9.)

## Create — PARTIAL/ASYNC
- `POST /v1/tenants` → creates a tenant row (no `iam_realm` and no workspace are auto-provisioned;
  the probe tenants `laprov*`/`laconsoleparity*` had `iam_realm=null`).
- `POST /v1/workspaces` → creates a workspace + a `workspace_databases` registry row and kicks off an
  **async provisioning saga** (`async_operations`/`async_operation_transitions` rows were created).
- **PROV-1 (MED): workspace DB provisioning does not complete (orphaned registry row).** A workspace
  `wsdb_laprov909_prod` had a `workspace_databases` row but **no backing physical database** — only the
  two long-lived demo workspaces (`wsdb_ops_demo_0610_ops_ws`, `wsdb_dp_demo_0510_primary`) have real
  `wsdb_*` databases. So newly-created workspaces get a registry row but the physical DB never
  materializes on the live runtime (the data-plane provisioner / saga doesn't finish). Combined with
  the shared-`in_falcone` runtime wiring (evidence/03), per-workspace databases are both unused AND
  not actually created for new workspaces.
- **Multiple projects per tenant:** multiple workspaces per tenant are accepted at the registry level
  (4 workspaces created across probe tenants).
- **Environments (prod/staging/dev):** NOT a first-class concept — an "environment" is only a
  workspace slug (e.g. workspace "prod" → `wsdb_<tenant>_prod`). There is no environment entity, no
  per-environment isolated resource set, and no `environment` field on the workspace create body.
  Multiple isolated environments per project = **not supported**.

## Delete / purge — NOT WIRED (no offboarding)
- **PROV-2 (HIGH): tenant deletion + cascading cleanup is not deployed.**
  `DELETE /v1/tenants/{t}` → **404 NO_ROUTE**; `POST /v1/tenants/{t}/purge` → **404 NO_ROUTE**
  (also deactivate/suspend/archive per the console agent). There is **no API path to delete or purge a
  tenant or its resources.** Tenants, workspaces, registry rows, async-op rows, and any provisioned
  Postgres/realm/bucket/topic resources accumulate with no cascading cleanup → orphaned (potentially
  cross-tenant) data with no remediation path. This is both a lifecycle gap and an isolation concern
  (the audit priority "deletion with cascading cleanup, no orphaned cross-tenant data" fails).
- Because deletion is unavailable, the probe tenants had to be removed by **direct SQL** against the
  control-plane DB (done; verified clean).

## Status
| Step | Status |
|---|---|
| Create tenant | Active (metadata row) |
| Create workspace (project) | Partial — registry row created, physical DB not provisioned (PROV-1) |
| Multiple projects per tenant | Active (registry) |
| Multiple environments per project | Not supported (workspace-slug only) |
| Delete/purge tenant + cascade cleanup | **Not deployed** (404) — PROV-2 |
| Orphan-free deletion | **Fails** (orphaned registry rows; no cleanup path) |
