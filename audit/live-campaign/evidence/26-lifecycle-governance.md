# 26 — Tenant/Project Lifecycle + Plans/Quotas/Governance + Metrics + Audit + Provisioning

Live empirical results against the running `falcone` kind namespace (HEAD). All calls via the
gateway `GW=http://localhost:9080` (Bearer JWT → control-plane). Superadmin + acme-ops (tenant_owner,
acme `78848e21…`) + globex-ops (tenant_owner, globex `fe63fa39…`). Datastore/realm checks via
PG `localhost:15432` (db `in_falcone`) and Keycloak admin at `http://localhost:8080`.

Route truth source: `deploy/kind/control-plane/route-map.json` (121 routes — the live CP catalog;
note the gateway-config `public-route-catalog.json` and `route-map.runtime.json` are partial/stale
vs. live). The live CREATE-tenant route is `POST /v1/tenants` (the catalog's `POST /v1/admin/tenants`
returns NO_ROUTE).

Legend: ✅ Active/Working · ⚠ Working-with-caveat · ❌ Broken · 🚫 Not-deployed/Not-routed.

---

## 1. Tenant lifecycle

| Functionality | Call | Status | Verdict |
|---|---|---|---|
| List tenants (paginated) | `GET /v1/tenants` (superadmin) | 200 `{items:[…],total:2,page:{after,size}}` | ✅ |
| Get tenant | `GET /v1/tenants/{id}` (superadmin) | 200 (snake+camel dual fields, `iam_realm`) | ✅ |
| Environments aggregate | `GET /v1/tenants/{id}/environments` | 200 `{catalog:[dev,staging,prod,sandbox,preview], environments:[{environment,workspaceCount,workspaces:[…]}]}` | ✅ |
| Create tenant | `POST /v1/tenants` (superadmin) | **201** → returns `sagaId` (durable provisioning saga); `iam_realm`=new tenant id | ✅ |
| ↳ realm provisioned | Keycloak `GET /admin/realms/{id}` | **200** (realm created by saga) | ✅ |
| ↳ registry row | `select count(*) from tenants where id=…` | **1** | ✅ |
| Soft-delete | `DELETE /v1/tenants/{id}` | **200** `{tenant:{status:"deleted"}, message:"…POST /v1/tenants/{id}/purge…"}` | ✅ |
| Purge (cascade) | `POST /v1/tenants/{id}/purge` | **200** `{purged:true, removed:{workspaces,databases,realm,buckets,topics}, residual:{knativeServices:[]}}` | ✅ |
| ↳ realm gone | Keycloak realm GET after purge | **404** | ✅ |
| ↳ registry gone | `select … from tenants` | **0 rows**; API `GET /v1/tenants/{id}` → **404 TENANT_NOT_FOUND** | ✅ |

**Two-phase lifecycle confirmed**: create (saga → realm + registry) → soft-delete → purge → full
cascade (realm 404, DB rows gone, API 404). Throwaway tenant `dc5bd3ed-…` created+purged cleanly.

## 2. Tenant users

| Functionality | Call | Status |
|---|---|---|
| List users | `GET /v1/tenants/{id}/users` | 200 `{items:[…],total,realm:<tenantId>}` (users live in per-tenant realm) | ✅ |
| Create user | `POST /v1/tenants/{id}/users` (acme-ops) | **201** `{userId, username, realm, roles:["tenant_developer"]}` | ✅ |

## 3. Workspaces / projects

| Functionality | Call | Status |
|---|---|---|
| List workspaces | `GET /v1/tenants/{id}/workspaces` | 200 `{items:[{…,environment}],total,page}` | ✅ |
| Get single workspace | `GET /v1/tenants/{id}/workspaces/{ws}` | **404 NO_ROUTE** — no per-workspace GET route | 🚫 (no route) |
| Create workspace | `POST /v1/tenants/{id}/workspaces` (acme-ops) | **201** (saga-backed) | ✅ |
| **Delete workspace** | `DELETE /v1/workspaces/{ws}` & `DELETE /v1/tenants/{id}/workspaces/{ws}` | **404 NO_ROUTE both** — **no workspace-delete API exists** | 🚫 (no route) |

### QUOTA ENFORCEMENT — ❌ NOT ENFORCED (see BUG-3)
acme already had 2 workspaces; default `max_workspaces` = 3 (migration 098 seed). Created **4 more**
sandbox workspaces (`lcwsq…x1..x4`) as acme-ops → **all 201**, no rejection. acme now has 6
workspaces. The create facade `apps/control-plane/src/console-backend-functions.mjs` has **no
`max_workspaces` / quota gate**; quota enforcement is wired only for flows/mcp/observability
(`flow-quota-gate.mjs`, `mcp-quota.mjs`), not for workspace/project creation. Compounded by an empty
`quota_dimension_catalog` (BUG-1) so plan-based limits cannot even be defined.

## 4. Environments model

Environment is a **fixed catalog enum** (`dev/staging/prod/sandbox/preview`), surfaced by
`GET /v1/tenants/{id}/environments` → `catalog`. Each **workspace carries an `environment` field**;
there is **no first-class environment CRUD** — `/environments` simply aggregates workspaces grouped
by their `environment`. Resource scoping is per-workspace (each workspace = a real PG database
`wsdb_<tenant>_<slug>`), so "environment isolation" is effectively workspace isolation. Verified
acme grouping after test: 1 prod, 1 staging, 4 sandbox.

## 5. Plans / quotas / entitlements

| Call | Status | Note |
|---|---|---|
| `GET /v1/plans` (superadmin) | 200 `{plans:[],total:0}` | empty (no plans seeded) |
| `GET /v1/quota-dimensions` | 200 `{dimensions:[],total:0}` | **empty** — `quota_dimension_catalog` table exists but **0 rows** (098 seed never ran) |
| `GET /v1/capability-catalog` | **500** `{code:"42P01"}` | **BUG-1** relation `boolean_capability_catalog` does not exist |
| `GET /v1/tenants/{id}/plan` | 200 `{noAssignment:true}` | acme has no plan |
| `GET /v1/tenants/{id}/plan/effective-entitlements` | 200 `{planSlug:null, quantitativeLimits:[], capabilities:[]}` | empty (no plan) |
| `GET /v1/tenants/{id}/plan/consumption` | 200 `{dimensions:[]}` | empty |
| `GET /v1/tenants/{id}/quota/effective-limits` | 200 `{noAssignment:true, effectiveLimits:[]}` | empty |
| `POST /v1/plans` (create) | **201** `{status:"draft"}` | ✅ create works |
| `POST /v1/plans/{id}/lifecycle {targetStatus:"active"}` | **200** | ✅ activate works (uses `targetStatus`, not `action`) |
| `PUT /v1/plans/{id}/limits/max_workspaces` | **400 INVALID_DIMENSION_KEY** | dimension not in (empty) catalog → **can't define limits** |
| `POST /v1/tenants/{id}/plan {planId,assignedBy}` | **500** `42P01` | **BUG-2** relation `tenant_plan_change_history` does not exist → **plan assignment broken** |
| Plan lifecycle deprecated→archived | 200/200 | ✅ |

**Verdict: the plan/quota governance subsystem is effectively NON-FUNCTIONAL on this deployment.**
Reads return empty 200s; defining limits fails (no dimensions); **assigning a plan throws 42P01**.
Root cause is a partial/failed bootstrap migration — the bootstrap job `falcone-in-falcone-bootstrap`
is in **Failed (BackoffLimitExceeded)** state, and the governance schema in `in_falcone` is
incomplete (23 tables total; the plan/capability/audit migration set 098/104/119 etc. did not fully
apply). Missing relations seen live: `boolean_capability_catalog`, `tenant_plan_change_history`,
`scope_enforcement_denials`; `quota_dimension_catalog` present but unseeded.

## 6. Metrics

| Call | Own-tenant status |
|---|---|
| `GET /v1/metrics/tenants/{id}/{quotas,overview,usage}` | 200 (empty dimensions — governance data absent) |
| `GET /v1/metrics/tenants/{id}/audit-records` | 200 `{items:[],page:{size:0}}` |
| `GET /v1/metrics/workspaces/{ws}/{quotas,overview,series}` | 200; `series` returns real `http_requests_per_second` points |

**Prometheus** (`http://localhost:59090`): `query=up` → success, but only **3 targets**:
`falcone-control-plane` **up=1**, `prometheus` up=1, **`falcone-apisix` up=0 (DOWN)**. Executor,
Keycloak, FerretDB, SeaweedFS, etc. are **not scraped**. CP exposes `falcone_http_requests_total`
(verified `sum by (component) rate(...)` = control-plane ≈ 1.86 rps).

**Grafana** (`http://localhost:53000`, v11.4.0, admin/admin default): DB ok; **2 provisioned
dashboards** — "Falcone — Platform Overview" (`falcone-platform`) and "Falcone — Per-Tenant"
(`falcone-tenant`) — wired to the single Prometheus datasource. Panel query
`sum by (component)(rate(falcone_http_requests_total[5m]))` returns **real data** → dashboards have
data for the control-plane component. (APISIX panels would be empty since that target is down.)

## 7. Audit logging

| Call | Status | Finding |
|---|---|---|
| `GET /v1/tenants/{id}/quota/audit` | 200 `{entries:[],total:0}` | empty even after creating users/workspaces |
| `GET /v1/metrics/tenants/{id}/audit-records` | 200 `{items:[]}` | empty |
| `GET /v1/tenants/{id}/scope-enforcement/audit?from=…&to=…` | **500** `42P01` | **BUG-4** relation `scope_enforcement_denials` does not exist |

**Audit stores return no lifecycle entries** — creating tenant users and 4 workspaces produced **zero**
quota/audit and metrics audit records, and **scope-enforcement audit 500s** on a missing table.
Governance audit logging is effectively not capturing lifecycle/admin actions on this deployment.
(`plan_audit_events` table exists but the queried audit surfaces are empty/missing.) No correlation
ids observed because no records are produced.

## 8. Provisioning lifecycle

- Workspace create → **real PG database** `wsdb_<tenant>_<slug>` created per workspace (verified
  `wsdb_acme_lcwsq…x1..x4` all present) + registry rows in `workspaces`/`workspace_databases`. ✅
- Tenant create → realm + tenant row (saga, `sagaId` returned). ✅
- Tenant purge → cascade removes realm + DBs + registry. ✅
- **Workspace teardown via API: NONE** (no DELETE route) → workspaces can be created but not deleted
  through the public surface. 🚫
- `POST /v1/async-operation-query` → **400 VALIDATION_ERROR** on empty/`{operationIds:[]}` body;
  requires `queryType` + (for detail/logs/result) `operationId` + `callerContext.actor.{id,type}`.
  Routed and reachable (auth ok), just needs valid params. ✅(routed)

---

## CROSS-TENANT ISOLATION PROBES (top priority)

Probed bidirectionally (acme-ops→globex and globex-ops→acme). Status = HTTP code returned.

| Probe (acme-ops → globex unless noted) | Status | Verdict |
|---|---|---|
| `GET /v1/tenants/{globex}` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/workspaces` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/users` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/plan` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/plan/effective-entitlements` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/plan/consumption` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/effective-capabilities` | **403** | ✅ denied |
| `GET /v1/tenants/{globex}/environments` | **403** | ✅ denied |
| **`GET /v1/tenants/{globex}/quota/effective-limits`** | **200** | ❌ **NOT denied (IDOR)** — echoes globex body (currently empty) |
| **`GET /v1/tenants/{globex}/quota/audit`** | **200** | ❌ **NOT denied (IDOR)** — globex audit (currently empty) |
| `GET /v1/tenants/{globex}/scope-enforcement/audit` | 500 | (table missing; not a clean leak, but no guard either) |
| **`GET /v1/metrics/tenants/{globex}/{overview,quotas,usage}`** | **200** | ❌ **NOT denied** — returns globex tenant metrics |
| **`GET /v1/metrics/tenants/{nonexistent-uuid}/overview`** | **200** | ❌ route does **no tenant validation at all** |
| **`GET /v1/metrics/workspaces/{globex-ws}/overview`** | **200** | ❌ **NOT denied** |
| **`GET /v1/metrics/workspaces/{globex-ws}/series`** | **200** | ❌ **LEAK — returns real non-empty time-series** (e.g. 61 points, Σ≈8.9 of globex `http_requests_per_second`) while globex-ops's own view differs → acme reads globex's live traffic data |
| `GET /v1/metrics/tenants/{globex}/audit-records` | **200** | ❌ NOT denied |
| `POST /v1/tenants/{globex}/workspaces` (create) | **403** | ✅ mutation denied |
| `POST /v1/tenants/{globex}/plan` (assign) | **403** | ✅ mutation denied |
| `POST /v1/tenants/{globex}/quota/overrides` (set) | **403** | ✅ mutation denied |

Reverse direction (globex-ops→acme) is **symmetric**: metrics/* and quota/{effective-limits,audit}
return 200; plan/consumption returns 403.

### Isolation verdict
- **MUTATIONS are correctly tenant-guarded** (cross-tenant create/assign/override all 403). Good.
- **The plan/tenant/workspace/users READ routes are correctly guarded** (403). Good.
- **TWO read surfaces leak cross-tenant (no tenant authorization):**
  1. **`/v1/metrics/*` (all tenant + workspace metrics)** — **P0**. Route family ignores caller
     tenant: returns 200 for any tenant (incl. a non-existent UUID) and **leaks globex's real
     workspace time-series traffic data to acme** (and vice-versa). `route-map.json` *declares*
     `auth: "tenant_owner own; superadmin any"` / `"workspace member"` but the live handler
     (`module: NONE`) does not enforce it.
  2. **`/v1/tenants/{id}/quota/effective-limits` and `/v1/tenants/{id}/quota/audit`** — **P1 IDOR**.
     Return 200 cross-tenant (no 403). Currently leak no sensitive payload only because globex's
     quota state is empty; with data present, acme would read globex quota limits/audit.

---

## BUGS (severity + repro)

- **BUG-ISO-METRICS (P0, tenant-isolation):** `/v1/metrics/tenants/{tenantId}/*` and
  `/v1/metrics/workspaces/{workspaceId}/*` perform **no tenant-scope authorization**. Repro:
  `curl $GW/v1/metrics/workspaces/$TB_WS/series -H "Authorization: Bearer <acme-ops>"` → 200 with
  globex's real `http_requests_per_second` series; same for `/metrics/tenants/$TB_TENANT/*`; even a
  random/non-existent tenant UUID → 200. Declared auth in route-map is not enforced by the live
  `module: NONE` handler.
- **BUG-ISO-QUOTA-READ (P1, tenant-isolation):** `GET /v1/tenants/{id}/quota/effective-limits` and
  `…/quota/audit` return 200 cross-tenant (no 403) — IDOR. Repro: acme-ops GET on globex tenant id
  → 200 (vs. 403 on the parallel `/plan/consumption`). Empty today only because globex quota state
  is empty.
- **BUG-MIG-CAPABILITY-CATALOG (P1):** `GET /v1/capability-catalog` → 500 `42P01` relation
  `boolean_capability_catalog` does not exist (migration 104 not applied).
- **BUG-MIG-PLAN-ASSIGN (P1):** `POST /v1/tenants/{id}/plan` (with `planId`+`assignedBy`) → 500
  `42P01` relation `tenant_plan_change_history` does not exist → **plan assignment broken**.
- **BUG-MIG-SCOPE-AUDIT (P2):** `GET /v1/tenants/{id}/scope-enforcement/audit` → 500 `42P01`
  relation `scope_enforcement_denials` does not exist.
- **BUG-QUOTA-DIMENSIONS-UNSEEDED (P1):** `quota_dimension_catalog` table exists but has **0 rows**
  (098 seed didn't run) → `GET /v1/quota-dimensions` empty and
  `PUT /v1/plans/{id}/limits/max_workspaces` → 400 `INVALID_DIMENSION_KEY`; you cannot define any
  plan limit, so plan-based quotas are undefinable.
- **BUG-WS-QUOTA-NOT-ENFORCED (P1):** workspace/project creation enforces no `max_workspaces` limit;
  the create facade (`console-backend-functions.mjs`) has no quota gate. Created 6 workspaces under a
  default-3 limit with all 201s.
- **BUG-NO-WS-DELETE (P2):** no `DELETE /v1/workspaces/{id}` (or tenant-scoped variant) route exists
  — workspaces can be created via API but not deleted; only full tenant purge cascades them.
- **Root-cause note:** the bootstrap job **`falcone-in-falcone-bootstrap` is in Failed state
  (BackoffLimitExceeded)**; the governance schema is incompletely migrated, which is the common
  cause of the four 42P01s and the unseeded dimension catalog.

## NOT-DEPLOYED / NOT-A-BUG
- Per-workspace `GET /v1/tenants/{id}/workspaces/{ws}` and `DELETE` workspace: not routed (NO_ROUTE),
  treated as missing routes, not crashes.
- Prometheus scraping is narrow (3 targets; APISIX target DOWN) — observability is partial, not a
  governance bug per se but limits dashboard coverage.

## WHAT I COULDN'T TEST / CAVEATS
- **End-to-end quota enforcement with a real limit**: blocked — cannot define a `max_workspaces` plan
  limit (empty dimension catalog) and plan assignment 500s (missing table). Demonstrated the
  enforcement gap directly via raw workspace creation instead.
- **Cleanup of 4 throwaway acme workspaces**: no workspace-delete API exists, and direct
  `DROP DATABASE`/registry DELETE on the shared `in_falcone` cluster was denied by the sandbox
  classifier. **Left behind (need operator cleanup):** workspaces
  `8e82358c…`, `c406dd34…`, `3e044070…`, `ac1bb13b…` (slugs `lcwsq24161x1..x4`, env sandbox, dbs
  `wsdb_acme_lcwsq24161x1..x4`) and tenant user `lcuser19513@acme.test`
  (`7274128d-127b-4dcb-92d5-3b6a373a1890`, acme realm). The test plan `lcplan19513`
  (`fbed1bf4-…`) was archived via API. Throwaway tenant `dc5bd3ed-…` was fully purged.
