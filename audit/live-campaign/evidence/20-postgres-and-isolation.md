# Live evidence — PostgreSQL data API + tenant/workspace/RLS isolation (cap-postgres-data-api)

Date: 2026-06-17 · Stack: kind ns `falcone`, fresh-from-HEAD · Auditor: subagent (postgres + isolation scope)

Targets: EXEC `http://localhost:18082` (executor data-plane), CP `http://localhost:18080` (control-plane browse), GW `http://localhost:9080` (APISIX), PG `localhost:15432`.
Fixtures: A=acme (`78848e21…`), staging ws `928534a8…` db `wsdb_acme_app_staging`; B=globex (`fe63fa39…`), staging ws `cc38c85c…` db `wsdb_globex_app_staging`. Prod ws/db per tenant also present.

Resources created (unique prefix `lcpg0d73` / `lcpgb0d73`) — **all cleaned up** (schemas dropped CASCADE; verified `[]` via browse API).

---

## Per-functionality status

### 1. DDL via executor (trust-header `exh`) — **Active/Working**
`POST /v1/postgres/databases/wsdb_acme_app_staging/schemas` → **201** `{"executed":true,...,"statements":["CREATE SCHEMA IF NOT EXISTS \"lcpg0d73\""]}`
`POST .../schemas/lcpg0d73/tables` (id int PK + note text) → **201**. The DDL executor auto-hardens every table:
```
CREATE TABLE "lcpg0d73"."t1" ("id" int NOT NULL PRIMARY KEY, "note" text)
ALTER TABLE ... ADD COLUMN IF NOT EXISTS "tenant_id" text NOT NULL DEFAULT current_setting('app.tenant_id', true)
GRANT USAGE ON SCHEMA ... TO "falcone_service","falcone_anon"
GRANT SELECT,INSERT,UPDATE,DELETE ON ... TO "falcone_service","falcone_anon"
ALTER TABLE ... ENABLE ROW LEVEL SECURITY
ALTER TABLE ... FORCE ROW LEVEL SECURITY
CREATE POLICY "t1_tenant_isolation" ... USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (...)
```
Every table is created with a `tenant_id` column, FORCE RLS, and a tenant-isolation policy. Grants go to non-superuser data roles, never to a BYPASSRLS role.

### 2. Row CRUD via API key (`exk`) — **Active/Working**
Note: real executor insert/update body shape is `{"values":{…}}` / `{"changes":{…}}` (or raw body), **NOT** the OpenAPI-declared `{"row":{…}}` (see BUG-PG-1).
- INSERT `POST .../rows` `{"values":{"id":1,"note":"…CONFIDENTIAL…"}}` → **201** `{"item":{…,"tenant_id":"78848e21…"},"affected":1,"access":{"reason":"grant_and_rls_allow","rlsEnforced":true}}` — `tenant_id` stamped server-side to A.
- LIST `GET .../rows` → **200** (2 items; `access.reason=grant_and_rls_filter, rlsEnforced:true, rowPredicateRequired:true`).
- GET by-PK `?id=1` → **200** `{"found":true,...}`.
- PATCH by-PK `?id=2` `{"changes":{"note":"patched-value"}}` → **200** `{"affected":1}`.
- DELETE by-PK `?id=2` → **200** `{"affected":1}`; subsequent LIST shows 1 row.

### 3. Browse via JWT (acme-ops, `tenant_owner`, tenant_id=A) — **Active/Working (but NOT tenant-scoped — see BUG-PG-2)**
acme-ops authenticates via `POST GW/v1/auth/login-sessions` (platform realm). All browse endpoints 200 against A's own objects:
- `GET /v1/postgres/databases` → 200 (lists 7 DBs).
- `.../{db}/schemas`, `.../tables`, `.../columns`, `.../indexes`, `.../policies`, `.../security` → all 200.
- security: `{"rlsEnabled":true,"forceRls":true,"policyCount":1,"state":"active"}`; policy `t1_tenant_isolation` USING/WITH CHECK `tenant_id = current_setting('app.tenant_id')`.

### 4. Vector search — **Not-deployed**
`POST .../tables/t1/search` → **422** `EMBEDDING_PROVIDER_MISSING`. Additionally `pg_available_extensions` shows `vector` **NOT AVAILABLE** in the wsdb_* databases. Route is wired (not 404) but the feature cannot run: no embedding provider config + no pgvector image. Not a bug.

### 5. Direct PostgreSQL (bypass API) — **Active/Working; isolation holds**
Connected as role `falcone` (pw from `in-falcone-postgresql` secret) to `localhost:15432`.
- All 4 per-workspace DBs exist as **separate physical databases**: `wsdb_acme_app_{staging,prod}`, `wsdb_globex_app_{staging,prod}`.
- Role attributes (CRITICAL): `falcone`, `falcone_anon`, `falcone_service` are **all `rolsuper=false, rolbypassrls=false`**. `falcone` is a member of `falcone_anon`+`falcone_service` (so the executor can `SET LOCAL ROLE`). No data-plane role bypasses RLS.
- A's row `lcpg0d73.t1` exists **only** in `wsdb_acme_app_staging` — not in shared `in_falcone`, not in B's DB. ⇒ executor routes each workspace to its **own** physical DB.

---

## CRITICAL ISOLATION PROBES (exact status)

| # | Probe | Result | Status |
|---|-------|--------|--------|
| 1 | A's API key → B's workspace data (`$TB_WS/$TB_DB/.../rows` list + get-by-PK) | `FORBIDDEN "Credential workspace does not match the requested workspace"` | **403 DENY ✅** |
| 2a | A's key + A's WS but **B's DB name** in path (DB-name confusion) | routed to A's DB; B table absent → `TABLE_NOT_FOUND` | **404 (no leak) ✅** |
| 2b | B's key + B's WS/DB path but **A's schema/table** name | routed to B's DB; A table absent → `TABLE_NOT_FOUND` | **404 (no leak) ✅** |
| 2c | B's key → A's WS/DB directly (`$TA_WS/$TA_DB/.../rows/by-pk?id=1`) | `FORBIDDEN "Credential workspace does not match"` | **403 DENY ✅** |
| 3 | Cross-ENV: A **staging** key → A **prod** ws/db (read + write) | `FORBIDDEN "Credential workspace does not match"` (both GET and POST) | **403 DENY ✅** |
| 4 | Trust-header forge: A's tenant-id + **B's** workspace-id (`exh`) | `CROSS_TENANT_VIOLATION "Workspace does not belong to the caller's tenant"` | **403 DENY ✅** |
| M1–M3 | A's owner JWT browses **B's** db schemas / tables / columns | returns B's schema `lcpgb0d73`, table `bsecret`, column `globex_classified` | **200 LEAK ❌ (metadata only — see BUG-PG-2)** |

### Shared-DB routing verdict (the central question)
**Per-workspace data isolation is EMPIRICALLY PROVEN for ROW DATA.** Direct-PG forensics:
- A's confidential row (`id=1`, `note=lc-acme-secret-CONFIDENTIAL-0d73`) lives **only** in `wsdb_acme_app_staging`.
- B (B's key) and A (A's key) cannot read each other's rows via any API path (403/404 above).
- RLS proof (as `falcone`, the DB-owning non-BYPASSRLS role) on `wsdb_acme_app_staging.lcpg0d73.t1`:
  - **no `app.tenant_id` GUC → 0 rows** (FORCE RLS fails closed even for the owner).
  - GUC=A → A's row visible.
  - GUC=B (wrong tenant) → **0 rows** (RLS hides the physically-present row).
  - `relrowsecurity=true, relforcerowsecurity=true`.
- Cross-DB: `falcone` can connect to `wsdb_globex_app_staging` (it owns it), but with GUC=A it reads **0** of B's rows; only GUC=B reveals B's row. RLS gates row access regardless of DB.

### Direct-PG RLS verdict
The `falcone` role is **NOT a superuser and NOT BYPASSRLS**, so it cannot trivially read all tenants' rows — RLS applies. BUT: RLS is keyed solely on the **`app.tenant_id` GUC**, which any holder of the `falcone` DB password can set to an arbitrary tenant id (`set_config('app.tenant_id', '<any-tenant>')`) and then read that tenant's rows from the corresponding wsdb. The `falcone` credential is a cluster-level secret (not exposed to tenants), so this is **defense-in-depth caveat, not an API-reachable leak**: row isolation at the API boundary is sound; at the raw-DB boundary it depends on the shared `falcone` password staying secret. See OBS-PG-3.

---

## BUGS

### BUG-PG-1 (P2 — contract/impl mismatch, NOT isolation) — Row insert/update body shape diverges from OpenAPI
- Repro: `POST .../rows` with the documented `{"row":{"id":1,...}}` → **400 `PLAN_REJECTED "Unknown column row on lcpg0d73.t1."`**. The executor reads `c.body.values ?? c.body` (`apps/control-plane/src/runtime/server.mjs:277`), but OpenAPI `PostgresDataInsertRequest` requires `row` and `PostgresDataUpdateRequest` uses `changes`. Clients following the published contract get a 400 and the field name is mis-treated as a column. Same divergence for update (`c.body.changes ?? c.body`).
- Severity P2: a real-credential functional defect (data-plane unusable via the documented body), but no security/isolation impact.

### BUG-PG-2 (P1 — cross-tenant metadata IDOR) — Postgres browse routes are not tenant-scoped
- Repro: as acme-ops (`tenant_owner`, tenant_id=A) `GET CP/v1/postgres/databases` returns **all** databases cluster-wide, including B's (`wsdb_globex_*` with B's tenantId/workspaceId) and internal DBs (`in_falcone`, `postgres`, `seaweedfs_filer`). Then `GET .../databases/wsdb_globex_app_staging/schemas` → 200 lists B's schema `lcpgb0d73`; `.../tables` → 200 `bsecret`; `.../columns` → 200 reveals column `globex_classified`. A enumerates B's full data model.
- Root cause (code): `deploy/kind/control-plane/routes.mjs:101-109` registers every `pgList*` browse route with `auth:'authenticated'` and no tenant guard; `deploy/kind/control-plane/pg-handlers.mjs:28-37` lists all non-template DBs with no `tenant_id` filter and the schema/table/column handlers take the DB name straight from the path with no check that the caller's tenant owns it.
- Impact: metadata-only (schema/table/column names, RLS posture) — **row DATA is NOT exposed** by these routes (rows go through the RLS-enforced executor data-plane, probes 1–2 above). Still a confidentiality leak of tenant B's data model to tenant A. P1.

## OBSERVATIONS (not filed as bugs)
- **OBS-PG-3 (defense-in-depth):** RLS is enforced via the `app.tenant_id` GUC under non-BYPASSRLS roles (correct), but the GUC is caller-asserted; anyone with the shared `falcone` DB password can impersonate any tenant at the raw-DB layer. Consider per-workspace dedicated DB roles (the provisioner supports `<db>_app` roles when CREATEROLE is available — `deploy/kind/control-plane/dataplane.mjs`; in this deploy it fell back to shared `falcone`).
- **OBS-PG-4 (deployment gap, not a bug):** the data-plane `/v1/postgres/workspaces/.../rows` routes are **not published through the gateway** — `GET GW/...rows` → 404 `NO_ROUTE`; the gateway-config catalog has 0 data-plane-rows routes. The data-plane is reachable only on the executor direct port (`falcone-cp-executor`, ClusterIP, internal-only). The executor's trust-header path is dev-trusted (`GATEWAY_SHARED_SECRET` unset) but the executor is not externally exposed, so forged trust-headers are not reachable from outside the cluster.

## What I could NOT test / why
- Vector search end-to-end: no embedding provider configured + pgvector extension not installed (route wired, returns 422). Not-deployed.
- Per-workspace dedicated DB roles (`<db>_app`): not provisioned in this deploy (shared `falcone` credential; provisioner needs CREATEROLE). Could not exercise the dedicated-role isolation path.

---

## ISOLATION VERDICT
**Tenant/workspace/environment ROW-DATA isolation is EMPIRICALLY PROVEN for the PostgreSQL data API.**
Every cross-tenant, cross-workspace, cross-DB-name, and cross-environment row-access probe is denied (403/404). Data routes to per-workspace physical DBs; FORCE RLS with a `tenant_id=current_setting('app.tenant_id')` policy is enforced under non-BYPASSRLS roles and fails closed without the GUC.
**One confirmed defect on the surface: BUG-PG-2 (P1) — the Postgres BROWSE/metadata routes are not tenant-scoped, leaking other tenants' database/schema/table/column structure (metadata only; no row data).** Plus BUG-PG-1 (P2 functional contract mismatch) and two defense-in-depth observations.
