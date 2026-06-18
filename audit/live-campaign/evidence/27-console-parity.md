# 27 — Web console: admin surface, API↔console parity & completeness, console tenant-scope isolation

Live run against the fresh-from-HEAD kind stack (ns `falcone`), 2026-06-18.
Browser: **Playwright chromium NOT available** (`npx playwright` exit 127, no browser binary) →
fell back to (a) enumerating console routes/pages from `apps/web-console/src` + the served SPA bundle,
and (b) replaying the EXACT `/v1/*` calls each page makes (the console is a thin SPA that calls
same-origin `/v1/*` with `Authorization: Bearer <session.accessToken>` — see
`apps/web-console/src/lib/console-session.ts::requestConsoleSessionJson`). This is valid evidence of
the live console surface. No screenshots (headless browser unavailable).

## Console served + login
- `GET http://localhost:9080/` → **200**, `text/html`, SPA shell `<title>In Falcone Console</title>`, root `#root`, bundle `/assets/index-S06EBwjn.js`.
- `GET /assets/index-*.js` → **200** `text/javascript` (683 KB). Deep-link `GET /console/tenants` → **200** HTML (SPA fallback wired at gateway).
- Direct console port `http://localhost:53001` → **000** (not port-forwarded this run; the console is reachable via the **gateway root** which is the production topology).
- Login: `POST /v1/auth/login-sessions` through the gateway works for all three principals:
  - `superadmin` → 200, `principal.platformRoles=['superadmin']`, `tokenSet.accessToken` present.
  - `acme-ops` → 200, `platformRoles=['tenant_owner']`, `tenantIds=[78848e21…(acme)]`.
  - `globex-ops` → 200, `tenantIds=[fe63fa39…(globex)]`.

## Console pages → backing `/v1/*` → live status

Page route source: `apps/web-console/src/router.tsx`. Backing endpoints extracted from each page's
service module. Status legend: **Working** (backend 200 for the intended principal) ·
**Broken** (backend reachable but errors/forbids the intended principal) ·
**Not-wired** (backend NO_ROUTE through the gateway the console talks to / not deployed).

| Console page (route) | Backing call (intended principal) | Live status | Notes |
|---|---|---|---|
| Welcome `/`, Login `/login`, Signup | `POST /v1/auth/login-sessions`, `/v1/auth/signups/policy` | **Working** | login 200 |
| Overview `/console/overview` | (static placeholder) | **Working** | no backend |
| **Shell tenant-switcher** (every `/console/*`) | `GET /v1/tenants?page[size]=100` (`console-context.tsx::listAccessibleTenants`) | **Broken for tenant operators** | superadmin 200; **acme/globex-ops → 403 `requires superadmin`**. See BUG-1. |
| Tenants `/console/tenants` | `GET /v1/tenants` | **Working (superadmin only)** | 200; create wizard `POST /v1/tenants/{id}/workspaces` works |
| Workspaces `/console/workspaces` | `GET /v1/workspaces?filter[tenantId]=…` ; `GET /v1/tenants/{id}/workspaces` | **Working** | 200 for superadmin + operator (operator scoped to own tenant) |
| Plans `/console/plans` (superadmin) | `GET /v1/plans`, `/v1/quota-dimensions`, `/v1/plans/{id}` | **Working (superadmin)** | 200; operator 403 (correct, page is superadmin-gated) |
| Tenant plan `/console/tenants/{id}/plan` (superadmin) | `GET /v1/tenants/{id}/plan`, `/plan/history` | **Working** | 200, `noAssignment:true`, history empty |
| My-plan `/console/my-plan` (operator) | `GET /v1/tenant/plan` (`getMyPlan`) | **Broken for operator** | **`/v1/tenant/plan` → 403 FORBIDDEN** and `/v1/tenant/plan/limits` → 403. `…/consumption`, `…/effective-entitlements`, `…/allocation-summary` → 200. See BUG-2. |
| My-plan allocation `/console/my-plan/allocation` | `GET /v1/tenant/plan/allocation-summary` | **Working** | 200 |
| Members `/console/members` | `GET /v1/tenants/{id}/users` (list) + `GET /v1/iam/realms/{realm}/users` & `/roles` (IAM panel) | **Partially broken for operator** | list 200 (alice/bob); **IAM realm panels → 403 `requires superadmin`** even on own realm. See BUG-3. |
| IAM access `/console/iam-access` (superadmin) | `GET /v1/iam/realms/{realm}/users|roles|clients|scopes` | **Working (superadmin)** | 200; operator 403 (correct) |
| Database `/console/database` & WS dashboard | `GET /v1/workspaces/{ws}/database`, `/api-keys` | **Working** | 200 |
| Service accounts `/console/service-accounts` | `GET /v1/workspaces/{ws}/service-accounts` | **Working** | 200 |
| Storage `/console/storage` | `GET /v1/storage/buckets`, `/v1/storage/workspaces/{ws}/usage` | **Working** | 200 (buckets empty, usage live) |
| Postgres `/console/postgres` (+ `/data`) | `GET /v1/postgres/databases`, `…/{db}/schemas/…/tables/…/columns` | **Working — but LEAKS (see BUG-4)** | 200; returns **all tenants' DBs + platform `in_falcone`** |
| Mongo `/console/mongo` (+ `/data`) | `GET /v1/mongo/databases`, `…/collections` | **Working** | 200 (empty) |
| Kafka/Events `/console/kafka`, `/console/events/data` | `GET /v1/events/workspaces/{ws}/inventory` | **Working — cross-tenant via path (BUG-6)** | inventory 200; `…/topics` (collection) → NO_ROUTE on GW |
| Functions `/console/functions` (+ registry/data) | `GET /v1/functions/workspaces/{ws}/actions`, `…/inventory` | **Working — cross-tenant via path (BUG-5)** | 200 |
| Quotas `/console/quotas` | `GET /v1/metrics/tenants/{id}/quotas`, `…/overview` | **Working — cross-tenant (BUG-7)** | 200 |
| Observability `/console/observability` | `GET /v1/metrics/tenants/{id}` / `…/workspaces/{ws}` (`+/overview,/quotas,/audit-*`) | **Working — cross-tenant (BUG-7)** | base path NO_ROUTE; `/overview`,`/quotas` 200 |
| Operations `/console/operations` | `POST /v1/async-operation-query` | **Working** | route present (400 on empty body = validation, page wired) |
| Secrets `/console/secrets` (+ rotation) | `GET /v1/platform/secrets/{domain}/{name}/consumer-status,history` ; `/v1/admin/backup/scope` | **Not-wired / Broken** | `/v1/platform/secrets/*` → **NO_ROUTE** on GW; `/v1/admin/backup/scope` → **500 `42P01`** (undefined_table). See BUG-8. |
| Flows `/console/flows` (+ designer/runs) | `GET /v1/flows/workspaces/{ws}/flows`, `…/task-types` | **Not-wired through the gateway** | GW → NO_ROUTE; works only on **executor :18082** (console uses same-origin GW). See BUG-9. |
| MCP server `/console/mcp/servers/{id}` | `GET /v1/mcp/servers/{id}` | **Not-wired through GW** | MCP served on executor only (`/v1/mcp/workspaces/{ws}/servers` 200 on 18082) |
| Realtime `/console/workspaces/{ws}/realtime`, `/console/realtime/changes` | `GET /v1/workspaces/{ws}/realtime` | **Not-deployed** | NO_ROUTE on BOTH gateway and executor |
| Docs `/console/workspaces/{ws}/docs` | `GET /v1/workspaces/{ws}/docs` | **Not-deployed** | NO_ROUTE on both |
| Capability catalog (workspace) | `GET /v1/workspaces/{ws}/capability-catalog` | **Not-deployed** | NO_ROUTE on both |
| Profile, Settings | static placeholders | **Working** | no backend |

## API ↔ Console parity (KEY)

Method: create via the SAME endpoint the console wizard uses, then confirm the resource appears on
the console's list endpoint(s) with matching fields.

| Resource | Created via (console wizard endpoint) | API value | Console list value | Match? |
|---|---|---|---|---|
| Workspace `lcconsole22274` | `POST /v1/tenants/{acme}/workspaces` (CreateWorkspaceWizard) → 201, id `c43f0a27…` | id `c43f0a27…`, slug `lcconsole22274`, tenant_id `78848e21` | `GET /v1/workspaces?filter[tenantId]=acme` → id/slug/name **identical**; `GET /v1/tenants/{acme}/workspaces` → present; superadmin global `GET /v1/workspaces` → present | **YES** (3 surfaces consistent) |
| Tenants (acme, globex) | seeded | superadmin `GET /v1/tenants` → `['globex','acme']` | tenant-switcher (`/v1/tenants`) shows same set for superadmin | **YES for superadmin** (operator can't load — BUG-1) |
| WS functions (acme staging) | seeded | `GET /v1/functions/workspaces/{ws}/actions` → 1 action, tenant_id acme | same endpoint = the FunctionsPage source | **YES** |
| WS api-keys / database (acme staging) | seeded | `GET /v1/workspaces/{ws}/api-keys`,`/database` → 200, real records | same endpoint backs the page | **YES** |
| Plan assignment (acme) | none | `GET /v1/tenants/{acme}/plan` → `noAssignment:true` | TenantPlan page reads same | **YES (consistent: no plan)** |

**Verdict: parity is CONSISTENT for resources whose backend the console can reach.** A console-created
workspace appears identically on every API list surface (id/slug/name), and vice-versa. **Completeness
has gaps** (below): several shipped console pages have no reachable backend through the gateway.

## Coverage gaps

**Console pages with NO working backend (through the gateway the console actually calls):**
- **Flows** (designer/run/history) — backend is on the executor (:18082) only; GW has no `/v1/flows` route. Console calls same-origin `/v1/flows/*` → 404. (BUG-9)
- **MCP server detail** — `/v1/mcp/*` on executor only; GW 404.
- **Secrets / Secret rotation** — `/v1/platform/secrets/*` → NO_ROUTE on GW; backup-scope variant → 500.
- **Realtime, workspace Docs, workspace Capability-catalog** — NO_ROUTE on both GW and executor (backend not deployed this build).
- **My-plan** (operator landing page) — its primary call `/v1/tenant/plan` → 403 (BUG-2).

**API capabilities/data with no console surface (or no delete path):**
- **Workspace delete** — no `DELETE /v1/workspaces/{id}` route on GW and no console delete action (created test ws can't be removed via the public surface; left as `lcconsole22274` in acme's own tenant).
- `/v1/quota-dimensions`, `/v1/plans/{id}/limits/{dim}` exist but are superadmin-only; tenant operators have no console view of their own quota-dimension catalog.

## Console tenant-scope isolation (TOP PRIORITY)

Probes run as `acme-ops` against `globex` resources (and the reverse for the tenant list).

**Correctly ENFORCED server-side (console scopes by token; spoofed filters ignored):**
- Tenant-switcher: operator `/v1/tenants` → 403 (cannot enumerate other tenants — but breaks the page, BUG-1).
- `GET /v1/workspaces?filter[tenantId]=GLOBEX` as acme-ops → returns **only acme** workspaces (spoofed filter ignored, token-scoped). No leak.
- `GET /v1/workspaces/{globex-ws}/service-accounts` → **403**; `…/api-keys` → **403 CROSS_TENANT_VIOLATION**; `…/database` → **403**; `/v1/tenants/{globex}/users` → **403**; `/v1/storage/workspaces/{globex-ws}/usage` → **404 WORKSPACE_NOT_FOUND**; `/v1/functions/actions/{globex-fn-id}/versions` → **404 ACTION_NOT_FOUND**.
- `/v1/iam/realms/{anyRealm}/users|roles` → **403 requires superadmin** for all realms (no cross-tenant IAM leak).

**CROSS-TENANT LEAKS surfaced via console pages (data of the OTHER tenant returned 200):**
1. **Postgres page** (`GET /v1/postgres/databases` + drill-down) — acme-ops sees **`wsdb_globex_app_prod`/`…_staging`** (tenant_id globex) AND the **platform control DB `in_falcone`** (23 tables incl. `flow_trigger_secrets`,`plans`,`saga_runs`,`quota_overrides`) + `postgres`/`seaweedfs_filer`. Drill-down works: schemas/tables/columns of `in_falcone` and globex DBs all return 200. Cluster-wide `pg_database` scan, **no tenant filter** (`deploy/kind/control-plane/pg-handlers.mjs::pgListDatabases`, route `auth:'authenticated'`). Row-data endpoint (`/v1/postgres/workspaces/{ws}/data/…/rows`) is NOT on the GW (404), so contents aren't reachable via this path — but full schema/structure of every tenant + the platform control plane leaks. **(BUG-4, P0/P1)**
2. **Functions page** (`GET /v1/functions/workspaces/{globex-ws}/actions` & `/inventory`) — acme-ops gets globex's action `lcfn3150` with `tenantId fe63fa39`. List leaks; by-id detail is guarded (404). **(BUG-5, P1)**
3. **Events/Kafka page** (`GET /v1/events/workspaces/{globex-ws}/inventory`) — acme-ops gets globex topic `res_topic_3d1fe56b`, `tenantId fe63fa39`. **(BUG-6, P1)**
4. **Quotas + Observability pages** (`GET /v1/metrics/tenants/{globex}/overview|quotas`, `/v1/metrics/workspaces/{globex-ws}/overview`) — all **200** for acme-ops, no tenant authz. Data currently empty (no breaches) but the endpoint accepts any tenant/workspace id. Matches the known metrics cross-tenant issue. **(BUG-7, P1)**

**Isolation verdict:** The console UI itself has no client-side tenant filter that would matter — it
trusts the API to scope. Core resource mutations (api-keys, service-accounts, database, members) and
the workspace listing ARE correctly token-scoped. **But four read/metadata surfaces that back live
console pages leak the other tenant's (and the platform's) data: Postgres metadata browser
(also leaks the control DB), Functions list, Events inventory, and Metrics.**

## BUGS

- **BUG-1 (P1, usability):** Console shell unusable for tenant operators. Shell tenant-switcher calls `GET /v1/tenants` (`auth:'superadmin'`, `routes.mjs:38`); operators → 403, so `console-context.tsx::loadTenants` catches, sets `tenants=[]`/`activeTenantId=null` → no workspace context → every tenant-scoped page empty. Repro: login `acme-ops`, open `/console/*`, switcher empty + `tenantsError`. Fix: an operator-scoped tenant-list (filter by `principal.tenantIds`) or relax to `authenticated` with server-side tenant filtering.
- **BUG-2 (P1):** My-plan page broken for operators. `GET /v1/tenant/plan` → 403 FORBIDDEN (and `/v1/tenant/plan/limits` → 403) for `tenant_owner`, though `/consumption`,`/effective-entitlements`,`/allocation-summary` work. The operator's own plan overview can't load.
- **BUG-3 (P2):** Members page IAM panel 403 for operators. `/v1/iam/realms/{ownRealm}/users` & `/roles` require superadmin; operator's own-realm role/user enrichment fails (the `/v1/tenants/{id}/users` list still works).
- **BUG-4 (P0/P1, tenant-isolation):** Postgres metadata browser leaks **all tenants' databases + platform control DB `in_falcone`** (table/column structure) to any authenticated tenant operator. `pgListDatabases` does a cluster-wide `pg_database` scan with no tenant filter; `pgListSchemas/Tables/Columns` accept any `{db}` with no ownership check. Repro: `GET /v1/postgres/databases` as acme-ops → globex DBs + `in_falcone`; `GET /v1/postgres/databases/in_falcone/schemas/public/tables` → 23 platform tables.
- **BUG-5 (P1, tenant-isolation):** Functions list leaks cross-tenant. `GET /v1/functions/workspaces/{otherTenantWs}/actions` as acme-ops → globex's actions (tenantId mismatch), no workspace-ownership check on the list endpoint.
- **BUG-6 (P1, tenant-isolation):** Events inventory leaks cross-tenant. `GET /v1/events/workspaces/{otherTenantWs}/inventory` as acme-ops → globex's topics.
- **BUG-7 (P1, tenant-isolation):** Metrics (Quotas + Observability pages) accept any tenant/workspace id with no authz. `GET /v1/metrics/tenants/{globex}/overview|quotas` and `…/workspaces/{globex-ws}/overview` → 200 for acme-ops. (Known metrics cross-tenant issue, reconfirmed via the console surface.)
- **BUG-8 (P2):** Secrets governance backing 500. `GET /v1/admin/backup/scope` → 500 `42P01` (undefined_table); `/v1/platform/secrets/*` not routed on GW → Secrets page can't load.
- **BUG-9 (P2, completeness):** Flows / MCP pages ship in the console but their backends (`/v1/flows/*`, `/v1/mcp/*`) are served only by the executor (:18082), not the gateway the console calls — these pages 404 from the deployed console.

## NOT-DEPLOYED (not bugs)
- `/v1/workspaces/{ws}/realtime`, `/v1/workspaces/{ws}/docs`, `/v1/workspaces/{ws}/capability-catalog` → NO_ROUTE on both GW and executor (backends not deployed this build; the corresponding console pages are inert, not broken code).

## Couldn't test
- Real browser DOM/visual rendering: **Playwright chromium not installed** — no screenshots; page status derived from source-mapped backing calls + live API replay.
- Row-level data of leaked Postgres DBs: the workspace-scoped data/rows endpoint isn't routed on the gateway, so content-level cross-tenant read couldn't be exercised via the console path (structure/metadata leak is confirmed).
- Cleanup of created workspace `lcconsole22274` (acme tenant): no `DELETE /v1/workspaces/{id}` route exists; left in place (unique-prefixed, acme-owned, does not affect globex).
