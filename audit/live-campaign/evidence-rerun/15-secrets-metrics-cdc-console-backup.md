# Live Campaign Evidence — C27/C31–C37: Secrets, Metrics, CDC, Console, Backup
**Date:** 2026-06-18  **Cluster:** kind test-cluster-b, ns `falcone`  **Tester:** sub-agent

---

## Infrastructure note
Keycloak pod restarted at ~16:16 UTC (pod age 29 min, restart count 1). KC uses H2 in-memory storage (no PVC) so the `in-falcone-platform` realm was wiped. All JWT-based evidence was captured before the restart (16:08–16:15). After the restart, JWT auth is unavailable (JWKS 404). Trust-header (EXEC direct) tests continued post-restart. This restart is a known kind/H2 limitation and is itself a finding (see BUG-15-4).

---

## C27 — Secrets / Config

### Endpoints tested
```
GET  /v1/workspaces/{ws}/secrets       → 404 NO_ROUTE (GW)
POST /v1/workspaces/{ws}/secrets       → 404 NO_ROUTE (GW)
GET  /v1/workspaces/{ws}/config        → 404 NO_ROUTE (GW)
GET  /v1/workspaces/{ws}/env-vars      → 404 NO_ROUTE (EXEC)
GET  /v1/secrets                       → 404 NO_ROUTE (CP)
```

### Vault deployment status
```
# Kind cluster pod check
kubectl -n falcone get pods | grep vault  →  (no output)

# Chart values
vault:
  enabled: false
```

No Vault pod, no ESO pod, no secrets API route. The `values.yaml` confirms `vault.enabled: false`. A separate `values-kind-vault.yaml` file exists for enabling it but was NOT applied to this install. No component reads from Vault at runtime.

### Verdict: **Not-deployed** (vault.enabled=false, no secrets API routes)

---

## C31 — Prometheus + Grafana Metrics

### Prometheus targets (http://localhost:59090/api/v1/targets)
```
Total: 5, UP: 4, DOWN: 1
  UP: falcone-control-plane  → http://falcone-control-plane.falcone.svc.cluster.local:8080/metrics
  UP: falcone-pods           → http://10.244.2.15:8080/metrics
  UP: falcone-pods           → http://10.244.1.63:8080/metrics
  UP: prometheus             → http://localhost:9090/metrics
  DOWN: falcone-apisix       → err: received unsupported Content-Type "text/html; charset=utf-8"
```
4/5 targets UP. APISIX metrics endpoint returns HTML instead of Prometheus text format.

### Prometheus query
```
GET /api/v1/query?query=up  → 5 results, falcone-control-plane=1, prometheus=1, falcone-pods=1
GET /api/v1/query?query=process_cpu_seconds_total  → 1 result (prometheus=5.89)
```

### Grafana (http://localhost:53000)
```
GET /api/health  → {"database":"ok","version":"11.4.0","commit":"b58701869e..."}
GET /api/search  → 3 items:
  "Falcone"                type=dash-folder
  "Falcone — Per-Tenant"   type=dash-db   uid=falcone-tenant
  "Falcone — Platform Overview" type=dash-db uid=falcone-platform
```
Grafana responsive, DB healthy, 3 dashboards loaded.

### Grafana Platform Overview dashboard (uid=falcone-platform)
```
panels: 3 — "Request rate (req/s) by component", "Error rate (5xx, req/s)", "p95 latency (s) by route"
```

### Falcone Metrics API (before KC restart — acme-ops JWT)
```
GET /v1/metrics/tenants/{id}           → 404 NO_ROUTE  (GW does NOT route this)
GET /v1/metrics/tenants/{id}/overview  → 200 {"overallPosture":"critical","hardLimitDimensions":["max_workspaces"]}
GET /v1/metrics/tenants/{id}/quotas    → 200 {"evaluatedAt":"...","dimensions":[...]}
GET /v1/metrics/workspaces/{ws}/series → 200 {"metricKey":"http_requests_per_second","points":[...]}
GET /v1/metrics/workspaces/{ws}/overview → 200 {"generatedAt":"...","overallPosture":"healthy"}
GET /v1/metrics/workspaces/{ws}/usage  → 200 {"measuredAt":"...","dimensions":[...]}
GET /v1/metrics/workspaces/{ws}/quotas → 200 {"evaluatedAt":"...","dimensions":[...]}
```
Note: `/v1/metrics/tenants/{id}` (bare, no sub-path) returns 404 — not routed.

### C31 Isolation (acme-ops → globex workspace metrics)
```
GET /v1/metrics/workspaces/{TB_WS}/series  → 403 {"code":"FORBIDDEN","message":"cannot read another tenant's metrics"}
GET /v1/metrics/workspaces/{TB_WS}/overview → 403 same
GET /v1/metrics/workspaces/{TB_WS}/usage   → 403 same
```
**ISOLATION PASS: metrics endpoints correctly block cross-tenant access.**

### Verdict: **Working** (4/5 Prometheus targets UP; Grafana healthy + 3 dashboards; workspace metrics API working; tenant-level metrics working except bare /v1/metrics/tenants/{id})

**MINOR FINDING:** APISIX Prometheus scrape endpoint returns HTML — may need metrics plugin config.

---

## C32 — API ↔ Console Parity

### Console bundle (http://localhost:53001/assets/index-CMaGxPS2.js)
Extracted 27 console routes and 108 API call patterns from the SPA bundle.

### Key console routes
```
/console/overview, /console/database, /console/events/data, /console/functions,
/console/iam-access, /console/kafka, /console/members, /console/mongo, /console/my-plan,
/console/observability, /console/operations, /console/plans, /console/postgres,
/console/profile, /console/quotas, /console/realtime/changes, /console/service-accounts,
/console/settings, /console/storage, /console/tenants, /console/workspaces
```

### API calls the console makes (verified against GW)

| Endpoint | Tenant Operator (acme-ops) | Superadmin |
|---|---|---|
| `GET /v1/tenant/effective-capabilities` | 200 ✓ | 200 ✓ |
| `GET /v1/tenant/plan/allocation-summary` | 200 ✓ | 200 ✓ |
| `GET /v1/tenant/plan/effective-entitlements` | 200 ✓ | 200 ✓ |
| `GET /v1/tenants` (console/tenants page) | **403 FORBIDDEN** | 200 ✓ |
| `GET /v1/plans` (console/plans page) | **403 FORBIDDEN** | 200 ✓ |
| `GET /v1/tenants/{id}` (own tenant) | 200 ✓ | — |
| `GET /v1/tenants/{id}/users` (members) | 200 ✓ | — |
| `GET /v1/tenants/{id}/workspaces` | 200 ✓ | — |
| `GET /v1/metrics/tenants/{id}/overview` | 200 ✓ | — |
| `GET /v1/tenants/{id}/plan` (my-plan page) | **403 FORBIDDEN** | 200 ✓ |
| `GET /v1/console/session` | **404 NO_ROUTE** | 404 |

### Parity findings
1. `/console/plans` page calls `GET /v1/plans` which requires superadmin → **403 for tenant operators** (console page non-functional for operators)
2. `/console/tenants` page calls `GET /v1/tenants` which requires superadmin → **403 for tenant operators**
3. `/console/my-plan` page calls `GET /v1/tenants/{id}/plan` → **403 for tenant operators** (even own tenant's plan)
4. `GET /v1/console/session` → 404 NO_ROUTE (referenced in console bundle, never implemented)
5. `/v1/metrics/tenants/{id}` (bare) → 404 NO_ROUTE (console references it but it's unrouted)

**API data consistency (where accessible):**
- Tenant name field blank in list (`name: ""`) but present in detail (`display_name: "Acme Inc"`) — field name mismatch
- Workspace list shows `id` field but workspace detail uses `workspaceId` — minor schema inconsistency

### Verdict: **Partial** — Data-plane and observability pages functional for operators; admin/plan pages 403 (superadmin-only endpoints used by operator console pages)

---

## C33 — Web Console Admin Surface

### Console shell availability
```
GET http://localhost:53001/  → 200 (SPA, 27 routes, correct meta)
```

### Operator (acme-ops / tenant_owner) page API mapping

| Console Page | API Call | Operator Result |
|---|---|---|
| /console/overview | /v1/tenants/{id} | 200 ✓ |
| /console/workspaces | /v1/tenants/{id}/workspaces | 200 ✓ |
| /console/members | /v1/tenants/{id}/users | 200 ✓ |
| /console/observability | /v1/metrics/tenants/{id}/overview | 200 ✓ |
| /console/quotas | /v1/metrics/workspaces/{ws}/quotas | 200 ✓ |
| /console/my-plan | /v1/tenants/{id}/plan | **403 FORBIDDEN** |
| /console/plans | /v1/plans | **403 FORBIDDEN** |
| /console/tenants | /v1/tenants | **403 FORBIDDEN** |
| /console/service-accounts | /v1/workspaces/{ws}/service-accounts | 200 ✓ |
| Effective caps | /v1/tenant/effective-capabilities | 200 ✓ |
| Plan entitlements | /v1/tenant/plan/effective-entitlements | 200 ✓ |

### Isolation probe (operator cross-tenant)
```
acme-ops → GET /v1/metrics/tenants/{TB_TENANT}/overview  → 403 FORBIDDEN ✓
acme-ops → GET /v1/metrics/tenants/{TB_TENANT}/quotas    → 403 FORBIDDEN ✓
acme-ops → GET /v1/tenants/{TB_TENANT}/plan/effective-entitlements → 403 FORBIDDEN ✓
```
**ISOLATION PASS: Operator scoped to own tenant.**

### BUG: /console/my-plan broken for tenant operators
The `/console/my-plan` page calls `GET /v1/tenants/{id}/plan` but this endpoint requires `superadmin` role. Tenant operators (tenant_owner role) get 403. This is the "operator shell broken" issue noted in prior campaign.

Evidence:
```
GET /v1/tenants/676c519b-.../plan (ATOK/tenant_owner) → 403 {"code":"FORBIDDEN","message":"FORBIDDEN"}
GET /v1/tenants/676c519b-.../plan (STOK/superadmin via CP) → 200 {"noAssignment":true,"tenantId":"676c519b-..."}
```
Root cause: `/v1/tenants/{id}/plan` is not in the public route catalog and is not routed via GW for JWT (returns 403, not 404); CP direct requires superadmin.

### Verdict: **Partial** — Console is up and most operator pages work; /console/my-plan and /console/plans/tenants broken for operators; /v1/console/session unimplemented

---

## C34 — CDC Bridges (pg-cdc / mongo-cdc)

### Pod check
```
kubectl -n falcone get pods | grep -i "cdc|capture|bridge"  → (no output)
```
No CDC bridge pods deployed.

### Endpoint check
```
GET /v1/workspaces/{ws}/pg-captures     → 404 NO_ROUTE (GW + EXEC)
GET /v1/realtime/{ws}/mongo-captures    → 404 NO_ROUTE (GW + EXEC)
GET /v1/mongo/workspaces/{ws}/captures  → 404 NO_ROUTE (EXEC)
GET /v1/realtime/workspaces/{ws}/pg-captures → 401 (EXEC, different path tried)
```

### Public route catalog check
```
grep "pg-captures|mongo-captures" public-route-catalog.json  →  0 routes
```
No routes, no pods, not in public catalog.

### Verdict: **Not-deployed**

---

## C35 — Webhooks (Flow Webhook Ingestion)

### Webhook ingestion endpoint (EXEC direct)
```
POST /v1/flows/workspaces/{ws}/triggers/webhooks/{triggerId}
  (via EXEC, trust-header, fake trigger id) → 401 {"code":"INVALID_SIGNATURE","message":"Invalid webhook signature"}
```
Route IS registered (INVALID_SIGNATURE is the correct fail-closed response for an unknown trigger id — the route handler loads the secret from the DB, finds nothing, returns 401). The HMAC verification path is active.

### Webhook management endpoints (create/list)
```
POST /v1/flows/workspaces/{ws}/triggers/webhooks       → 404 NO_ROUTE (EXEC)
GET  /v1/flows/workspaces/{ws}/triggers/webhooks       → 404 NO_ROUTE (EXEC)
POST /v1/flows/workspaces/{ws}/flows/{id}/triggers/webhooks → 404 NO_ROUTE (EXEC)
```
No management API to create/list/delete webhook triggers through the REST API. Webhook triggers are registered only via flow publish (the `triggers.kind=webhook` DSL field in the flow definition). Management endpoints are not exposed.

### Publishing a flow with webhook trigger
```
POST /v1/flows/workspaces/{ws}/flows  (definition with kind=webhook trigger)  → 201 ✓
POST /v1/flows/workspaces/{ws}/flows/{id}/versions (publish)
  → 502 {"code":"TRIGGER_REGISTRATION_FAILED","message":"Internal server error"}
```
Flow publish with webhook trigger fails: trigger registration returns 502. Root cause unclear from CP logs (no specific error visible in tail).

### GW webhook route
```
POST /v1/flows/workspaces/{ws}/triggers/webhooks/{id} (GW)
  → 401 {"code":"UNAUTHENTICATED","message":"Missing tenant identity"}
```
GW requires tenant identity header for flows routes — webhooks need to be called via executor directly or require a gateway-routed public webhook URL.

### Isolation probe
```
POST /v1/flows/workspaces/{TB_WS}/triggers/webhooks/fake-id  (TA identity via exh)
  → 403 {"code":"CROSS_TENANT_VIOLATION","message":"Workspace does not belong to the caller's tenant"}
```
**ISOLATION PASS: Cross-tenant webhook ingestion blocked.**

### Cleanup
The test flow created (576cb096-ec2c-4f99-851e-5f8488c23a1f) could not be deleted (DELETE route returns 404/500). Flow remains in DB.

### Verdict: **Partial** — Ingestion route active (HMAC fail-closed works); management routes absent; publish of webhook-trigger flow fails with 502; GW requires auth on webhook ingestion path (intended for public webhooks)

**BUG-15-1 (P2): Flow publish with webhook trigger returns 502 TRIGGER_REGISTRATION_FAILED**

---

## C36 — Scheduling / Cron

### Pod check
```
kubectl -n falcone get pods | grep -i sched  → (no output)
```
No scheduling-engine pod. However, `/v1/scheduling/*` IS routed via the control-plane.

### Endpoint check
```
GET /v1/scheduling (GW, authenticated)  → 500 {"code":"ERR_MODULE_NOT_FOUND","message":"Internal server error"}
GET /v1/scheduling (GW, superadmin)     → 401 (token verification failing due to KC restart)
GET /v1/scheduling/jobs (GW)            → 404 NO_ROUTE
```

### Root cause analysis
Control-plane logs:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/repo/services/scheduling-engine/actions/scheduling-management.mjs'
  imported from /app/server.mjs
  url: 'file:///repo/services/scheduling-engine/actions/scheduling-management.mjs'
```

Route map (`deploy/kind/control-plane/route-map.runtime.json`):
```json
{
  "method": "ANY",
  "path": "/v1/scheduling/*",
  "module": "/repo/services/scheduling-engine/actions/scheduling-management.mjs",
  ...
}
```

Dockerfile (`apps/control-plane/Dockerfile`):
```
COPY apps/control-plane/src ...
COPY services/adapters/src ...
COPY services/internal-contracts/src ...
COPY services/mongo-cdc-bridge/src ...
COPY services/workflow-worker/src/activities/catalog-names.mjs ...
COPY services/audit/src ...
COPY services/webhook-engine/src ...
# services/scheduling-engine is NOT copied
```

The file exists in the source tree (`services/scheduling-engine/actions/scheduling-management.mjs`) but was not included in the Dockerfile COPY directives. Every request to `/v1/scheduling/*` crashes with a module-not-found error.

### Verdict: **Broken** — Route registered, module file missing from container image

**BUG-15-2 (P1): /v1/scheduling/* crashes 500 ERR_MODULE_NOT_FOUND — scheduling-engine/actions not COPY'd in Dockerfile**

---

## C37 — Backup / Restore

### Endpoint check
```
GET /v1/admin/backup              → 404 NO_ROUTE (GW + CP)
GET /v1/admin/backup/tenants      → 404 NO_ROUTE (GW)
GET /v1/tenants/{id}/backup       → 404 NO_ROUTE (GW + CP)
GET /v1/tenants/{id}/backup-scope → 404 NO_ROUTE (GW + CP)
```

### Route catalog check
```
python3: grep backup public-route-catalog.json  →  0 backup routes
```

### Pod check
No backup/restore pods in the cluster.

### Code evidence
`tests/blackbox/backup-status-jwt-signature.test.mjs` and related test files exist, and `services/provisioning-orchestrator/src/actions/backup-scope-get.mjs` and `backup-scope-events.mjs` exist in source. However no routes are registered and no pods deployed.

### Verdict: **Not-deployed** — Backup routes not in route catalog; no backing pods; routes return 404

---

## Infrastructure Finding: Keycloak H2 In-Memory Persistence

During testing (~16:16 UTC), the Keycloak pod restarted (restart count went from 0 to 1). KC uses H2 in-memory storage (confirmed: deployment has `volumes: []`, `volumeMounts: []`, no DB env vars). The `in-falcone-platform` realm was wiped. The bootstrap job had already completed and cannot be re-run automatically.

**BUG-15-3 (P1): Keycloak uses H2 in-memory DB — realm state lost on pod restart, makes the entire platform unavailable until bootstrap re-runs**

Impact: After KC restart, `GET /realms/in-falcone-platform` returns `{"error":"Realm does not exist"}`. No JWT can be issued, no tenant can log in, control-plane JWKS fetch fails. The bootstrap job is a post-install/post-upgrade Helm hook with `helm.sh/hook-delete-policy: before-hook-creation` and cannot be triggered without a `helm upgrade`.

---

## Summary Table

| Cap | Feature | Status | Evidence |
|-----|---------|--------|---------|
| C27 | Secrets/Config API | Not-deployed | 404 NO_ROUTE on all secrets endpoints |
| C27 | Vault | Not-deployed | vault.enabled=false, no pod |
| C31 | Prometheus targets | Partial | 4/5 UP; APISIX DOWN (HTML content type) |
| C31 | Prometheus query | Working | `up` and `process_cpu_seconds_total` return data |
| C31 | Grafana health | Working | 200 DB:ok v11.4.0 |
| C31 | Grafana dashboards | Working | 3 dashboards loaded |
| C31 | Metrics API /workspaces/*/series | Working | 200 with data points |
| C31 | Metrics API /workspaces/*/overview | Working | 200 |
| C31 | Metrics API /workspaces/*/usage | Working | 200 |
| C31 | Metrics API /tenants/*/overview | Working | 200 |
| C31 | Metrics API /tenants/{id} bare | Not-deployed | 404 NO_ROUTE |
| C31 | Metrics isolation | **PASS** | cross-tenant → 403 FORBIDDEN |
| C32 | API↔Console parity | Partial | Most data consistent; 3 endpoints 403 for operators; /v1/console/session 404 |
| C32 | Workspace name in list | Bug (minor) | name="" in list but display_name present in detail |
| C33 | Console SPA serving | Working | 200, 27 routes, assets load |
| C33 | Operator pages (overview/members/workspaces) | Working | 200 |
| C33 | /console/my-plan | **Broken** | 403 for tenant_owner on /v1/tenants/{id}/plan |
| C33 | /console/plans | Broken (superadmin-only) | 403 for tenant_owner |
| C33 | /v1/console/session | Not-deployed | 404 NO_ROUTE |
| C33 | Console isolation | **PASS** | operator scoped to own tenant |
| C34 | pg-cdc | Not-deployed | No pods, no routes |
| C34 | mongo-cdc | Not-deployed | No pods, no routes |
| C35 | Webhook ingestion route | Working | HMAC fail-closed 401 |
| C35 | Webhook publish (webhook-trigger flow) | **Broken** | 502 TRIGGER_REGISTRATION_FAILED |
| C35 | Webhook management API | Not-deployed | No list/create/delete routes |
| C35 | Webhook isolation | **PASS** | cross-tenant → 403 CROSS_TENANT_VIOLATION |
| C36 | Scheduling /v1/scheduling/* | **Broken** | 500 ERR_MODULE_NOT_FOUND |
| C37 | Backup/restore | Not-deployed | 404 NO_ROUTE on all paths |

---

## Bugs

| ID | Sev | Summary | Repro |
|----|-----|---------|-------|
| BUG-15-1 | P2 | Webhook-trigger flow publish fails 502 TRIGGER_REGISTRATION_FAILED | Create flow with `triggers:[{kind:"webhook"}]`, POST to `/v1/flows/workspaces/{ws}/flows/{id}/versions` → 502 |
| BUG-15-2 | P1 | `/v1/scheduling/*` crashes 500 ERR_MODULE_NOT_FOUND on every request | ANY `/v1/scheduling` authenticated request → 500; root cause: `services/scheduling-engine/actions/scheduling-management.mjs` not in Dockerfile COPY |
| BUG-15-3 | P1 | Keycloak H2 in-memory — realm lost on pod restart, full platform outage | KC pod restart → `in-falcone-platform` realm gone → all JWT issuance fails → CP JWKS 404 → auth fully broken |
| BUG-15-4 | P2 | `/console/my-plan` broken for tenant operators — 403 on `/v1/tenants/{id}/plan` | Login as acme-ops, GET `/v1/tenants/{id}/plan` → 403; route requires superadmin role, not tenant_owner |
| BUG-15-5 | P1 | `/v1/console/session` referenced by SPA bundle but returns 404 NO_ROUTE | GET `/v1/console/session` from console bundle → 404; may break session management in the SPA |

---

## Not-Deployed (not bugs)
- **C27 Secrets/Vault**: `vault.enabled=false` in values; no API routes; by design
- **C34 CDC Bridges**: No pg-cdc or mongo-cdc pods; routes absent
- **C37 Backup/Restore**: No routes in route catalog; no pods

## Could Not Test / Partially Tested
- **C33 /console/plans, /console/tenants**: Pages require superadmin — correct behavior, but means operator users see 403 in console (UI should hide these routes for operators)
- **C36 detailed testing** (scheduling operations): Route crashes before any business logic executes
- **Post-KC-restart JWT-based tests**: All JWT auth unavailable after KC pod restart at ~16:16

## Isolation Verdict
| Surface | Result |
|---------|--------|
| Metrics workspace (C31) | **PASS** — cross-tenant 403 |
| Metrics tenant (C33) | **PASS** — cross-tenant 403 |
| Plan entitlements (C33) | **PASS** — cross-tenant 403 |
| Webhook ingestion (C35) | **PASS** — cross-tenant 403 CROSS_TENANT_VIOLATION |

All tested isolation surfaces pass. No cross-tenant leakage detected on C27/C31–C37 surfaces.
