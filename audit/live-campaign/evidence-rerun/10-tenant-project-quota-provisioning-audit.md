# Live Campaign Evidence — C1-C5, C28-C30 (Tenant / Project / Quota / Provisioning / Audit)

**Run date:** 2026-06-18  
**Stack tag:** head-20260618  
**Namespace:** `falcone` (kind test-cluster-b)  
**Tester:** subagent (empirical HTTP probes)

> **Cluster incident during run:** Keycloak pod OOM-killed (exit 137) at ~16:15 UTC after running 21 min.  
> KC lost all realm data (no PVC). JWT-based management endpoints returned `INVALID_CREDENTIALS`
> from ~16:15 onward. Tests completed before KC crash (C1–C5 management routes, C28, C29 plan
> history) are fully evidenced. Post-crash tests used API-key / trust-header paths (executor direct).

---

## C1 — Tenant Lifecycle

**Status: Working (create/get/delete/purge) | Not-deployed: GET single-tenant via tenant-op route**

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants` (superadmin) | Working | 200 `{items:[...], total:2}` | Returns both tenants with correct envelope |
| `GET /v1/tenants/{id}` (superadmin) | Working | 200 `{tenant:{...}, id:..., tenantId:...}` | **BUG-C1-DUP**: response duplicates tenant object at root AND under `.tenant` key |
| `POST /v1/tenants` (superadmin) | Working | 201 | Created tenant `lc26814`; realm provisioned |
| `DELETE /v1/tenants/{id}` (superadmin) | Working | 200 `{tenant:{id, status:"deleted"}, message:"...POST .../purge"}` | Marks deleted; instructs explicit purge |
| `POST /v1/tenants/{id}/purge` (superadmin) | Working | 200 `{purged:true, removed:{workspaces:0, databases:[], realm:"lc26814-id", buckets:[], topics:[]}}` | Cascade confirmed; realm deleted from KC |
| `GET /v1/tenants/{id}` (post-purge) | Working | 404 `TENANT_NOT_FOUND` | Correctly removed |

**Cascade verification:** purge returned `realm: "012621d1-333f-4f10-86c9-812af2a58bf7"` confirming KC realm deletion. DB `purged.databases:[]` (tenant had no workspaces at purge time — correct).

**Isolation probes (C1):**

| Probe | Expect | Actual | Status |
|---|---|---|---|
| acme-ops `GET /v1/tenants/globex-id` | 403 | 403 `FORBIDDEN: cannot read another tenant` | PASS |
| acme-ops `GET /v1/tenants` (list all) | 403 | 403 `FORBIDDEN: requires superadmin` | PASS |
| globex-ops `GET /v1/tenants/acme-id` | 403 | 403 `FORBIDDEN: cannot read another tenant` | PASS |

---

## C2 — Tenant Users

**Status: Working**

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants/{id}/users` (acme-ops) | Working | 200 `{items:[4 users], total:4, realm:"..."}` | Lists alice, bob, owner, enduser |
| `POST /v1/tenants/{id}/users` (acme-ops) | Working | 201 `{userId:..., username:"lc-test-9682@acme.test", realm:..., roles:["tenant_developer"]}` | User created with default role |

**Isolation (C2):**

| Probe | Expect | Actual | Status |
|---|---|---|---|
| acme-ops `GET /v1/tenants/globex-id/users` | 403 | 403 `FORBIDDEN: requires superadmin or tenant owner/admin of this tenant` | PASS |

---

## C3 — Projects / Workspaces

**Status: Partial — list/create Work; GET/DELETE single workspace NOT-DEPLOYED at tested path**

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants/{id}/workspaces` (acme-ops) | Working | 200 `{items:[...], total:2}` | Both staging/prod listed with environment field |
| `GET /v1/tenants/{id}/workspaces/{wsId}` | Not-deployed | 404 `NO_ROUTE` | Route not mapped; catalog has `/v1/workspaces/{id}` (no tenant scoping) |
| `POST /v1/tenants/{id}/workspaces` (acme-ops) | Working | 201 `{workspace:{id, slug:"lc-ws-16829", environment:"dev",...}, database:{...}}` | Creates WS with DB provisioned |
| `DELETE /v1/tenants/{id}/workspaces/{wsId}` | Not-deployed | 404 `NO_ROUTE` | Route not mapped; catalog has `/v1/workspaces/{id}` DELETE |

**Test workspace created:** `lc-ws-16829` / `8476d445-18ee-4c4e-a2ae-3830b9286007`  
(Cannot clean up via API; KC outage prevents JWT-based management calls. Requires manual deletion or KC recovery.)

**Isolation (C3):**

| Probe | Expect | Actual | Status |
|---|---|---|---|
| acme-ops `GET /v1/tenants/globex-id/workspaces` | 403 | 403 `FORBIDDEN: requires superadmin or tenant owner/admin` | PASS |

---

## C4 — Environments

**Status: Working — environment is a workspace field + a tenant-scoped view endpoint exists**

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants/{id}/environments` (acme-ops) | Working | 200 `{catalog:["dev","staging","prod","sandbox","preview"], environments:[{environment:"dev", workspaceCount:1, workspaces:[...]}, ...]}` | Aggregate view by environment |
| `GET /v1/tenants/{id}/workspaces/{id}/environments` | Not-deployed | 404 `NO_ROUTE` | No sub-route per workspace |
| Workspace object `environment` field | Working | — | Each WS has `environment: "dev"/"staging"/"prod"` field |

**Environment is a field on workspace, not a first-class resource.** The `/v1/tenants/{id}/environments` endpoint provides a catalog view aggregating workspaces by environment type.

**Isolation (C4):**

| Probe | Expect | Actual | Status |
|---|---|---|---|
| acme-ops `GET /v1/tenants/globex-id/environments` | 403 | 403 `FORBIDDEN: requires superadmin or tenant owner/admin` | PASS |

---

## C5 — Plans / Quotas / Entitlements / Consumption

**Status: Partial — entitlements/consumption Working; plan CREATE Working; plan ACTIVATE Working; plan ASSIGN Broken (P1 bug)**

### Plan CRUD

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/plans` (superadmin) | Working | 200 `{plans:[], total:0}` | Empty on fresh install (correct) |
| `POST /v1/plans` without `slug` | Broken | 400 `INVALID_SLUG` | `slug` is required but not documented in error message |
| `POST /v1/plans` with `slug` | Working | 201 `{id:..., slug:"lc-starter", status:"draft", ...}` | Plan created in draft state |
| `PUT /v1/plans/{id}` without any fields | Broken | 400 `VALIDATION_ERROR: No updates provided` | Silent error — sent `{status:"active"}` which is NOT an updateable field via PUT |
| `POST /v1/plans/{id}/lifecycle` `{targetStatus:"active"}` | Working | 200 `{previousStatus:"draft", newStatus:"active"}` | Lifecycle transition works |
| `POST /v1/tenants/{id}/plan` (assign) | **Broken P1** | 500 `22003 Internal server error` | **INTEGER OVERFLOW** in `plan-change-history-repository.mjs` |

### Plan Assignment Bug (P1 — BUG-C5-INT-OVERFLOW)

**Root cause:** `insertQuotaImpacts` stores `observedUsage` / `effectiveValue` in a PostgreSQL `INTEGER` column (schema: `migration/100-plan-change-impact-history.sql`). The usage collector for the `storage_bytes_used` dimension returns the value in bytes (5 × 1024³ = 5,368,709,120) which exceeds `INTEGER` max (2,147,483,647).

**Evidence from CP logs:**
```
error: value "5368709120" is out of range for type integer
  at async Module.insertQuotaImpacts (plan-change-history-repository.mjs:69)
  at async Module.insertWithHistory (plan-assignment-repository.mjs:88)
  at async main (plan-assign.mjs:68)
```

This occurs even when the plan has no explicit `quotaDimensions` (the usage collectors still run for all catalog dimensions). **Every plan assignment fails with HTTP 500.** No plan has ever been successfully assigned to any tenant.

### Entitlements / Consumption (catalog defaults work without plan assignment)

| Operation | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants/{id}/plan` (no assignment) | Working | 200 `{noAssignment:true, tenantId:...}` | Correctly reports no assignment |
| `GET /v1/tenants/{id}/plan/effective-entitlements` (superadmin) | Working | 200 `{quantitativeLimits:[...12 dimensions...], booleanCapabilities:[...]}` | Uses catalog defaults |
| `GET /v1/tenant/plan/effective-entitlements` (ops self-route) | Working | 200 | Same data via tenant-scoped self-route |
| `GET /v1/tenants/{id}/plan/consumption` (superadmin) | Working | 200 `{dimensions:[...], snapshotAt:...}` | Usage queried; most unknown (`NO_QUERY_MAPPING`); `max_api_keys: 4` correctly populated |
| `GET /v1/tenant/plan/consumption` (ops self-route) | Working | 200 | Same data via self-route |
| `GET /v1/tenants/{id}/plan/allocation-summary` | Working | 200 `{dimensions:[...with tenantEffectiveValue, totalAllocated, unallocated...]}` | Full breakdown |
| `GET /v1/tenants/{id}/plan/history` | Working | 200 `{assignments:[], total:0}` | Empty (no successful assignments) |
| `GET /v1/tenants/{id}/plan/history-impact` | Working | 200 `{items:[], total:0}` | Empty |

**Isolation (C5):**

| Probe | Expect | Actual | Status |
|---|---|---|---|
| acme-ops `GET /v1/tenants/globex-id/plan/effective-entitlements` | 403 | 403 `FORBIDDEN` | PASS |
| acme-ops `GET /v1/tenants/globex-id/plan/consumption` (not tested — KC down) | 403 | — | NOT TESTED (KC outage) |

---

## C28 — Quota Enforcement

**Status: Working — `max_workspaces` enforced at 402**

| Test | Status | HTTP | Notes |
|---|---|---|---|
| `GET effective-entitlements` → `max_workspaces: 3` | Working | 200 | Catalog default limit confirmed |
| Current workspace count: 3 (app-prod + app-staging + lc-ws-16829) | — | — | At limit |
| `POST /v1/tenants/{id}/workspaces` (4th workspace, over limit) | **Enforced** | 402 `QUOTA_EXCEEDED: workspace quota reached (max_workspaces): 3/3` | Quota gate active |

**Rate-limit (429)** testing was not attempted — requires the APISIX `limit-count` plugin and JWT auth (KC down post-16:15).

---

## C29 — Audit Logging

**Status: Partial — plan_audit_events populated with correlation IDs; quota enforcement logs empty; /v1/metrics routes not deployed at GW**

### DB-level evidence (direct PG query)

| Audit table | Records | Notes |
|---|---|---|
| `plan_audit_events` | 19 rows | Action types: tenant.create, tenant.delete, tenant.purge, tenant.user.create, workspace.create, plan.created, plan.lifecycle_transitioned |
| `quota_enforcement_log` | 0 rows | Not populated even on QUOTA_EXCEEDED enforcement (C28) — **BUG-C29-NO-ENFORCEMENT-LOG** |
| `scope_enforcement_denials` | 0 rows | Not populated on cross-tenant 403 denials |
| `tenant_plan_assignments` | 0 rows | No successful plan assignments (C5 bug) |

### HTTP endpoint evidence

| Route | Status | HTTP | Notes |
|---|---|---|---|
| `GET /v1/tenants/{id}/plan/history` | Working | 200 | Returns empty list (no successful assignments) |
| `GET /v1/tenants/{id}/plan/history-impact` | Working | 200 | Returns empty list |
| `GET /v1/tenants/{id}/plan/allocation-summary` | Working | 200 | Shows all dimension allocations |
| `GET /v1/metrics/tenants/{id}/audit-records` | Not-deployed | 401 `UNAUTHENTICATED` | Route not registered in APISIX; returns 401 (no route match, KC auth plugin applied to catch-all) |
| `GET /v1/observability/quota-audit` | Not-deployed | 404 `NO_ROUTE` | No gateway route |
| `GET /v1/observability/scope-enforcement` | Not-deployed | 404 `NO_ROUTE` | No gateway route |

**Correlation IDs present:** audit events with `camp-` prefix correlation IDs (from seeding); events from this test run also have `la-` correlation IDs from the live-audit lib.

**BUG-C29-NO-ENFORCEMENT-LOG:** The `quota_enforcement_log` table is empty despite the C28 `QUOTA_EXCEEDED` response. The quota gate fires at the application layer but does NOT write to the DB audit log. The `scope_enforcement_denials` table is similarly empty despite 403 cross-tenant denials.

**Isolation (C29):**
| Probe | Expect | Actual | Status |
|---|---|---|---|
| globex-ops `GET /v1/tenants/acme-id/plan/history` | 403/401 | 401 (KC down post-test) | Not conclusively tested (KC outage) |

---

## C30 — Provisioning Lifecycle

**Status: Partial Working — create/provision confirmed; delete route Not-deployed; cleanup via purge confirmed**

### Workspace provisioning

| Test | Status | Notes |
|---|---|---|
| `POST /v1/tenants/{id}/workspaces` response includes `database:{...}` | Working | DB provisioned inline |
| PG DB `wsdb_acme_lc_ws_16829` exists in PostgreSQL | Working | Confirmed via `pg_database` query |
| Workspace DBs confirmed: `wsdb_acme_app_prod`, `wsdb_acme_app_staging`, `wsdb_acme_lc_ws_16829`, `wsdb_globex_app_prod`, `wsdb_globex_app_staging` | Working | All 5 DBs confirmed |

### Data API after provisioning (executor direct)

| Test | Status | HTTP | Notes |
|---|---|---|---|
| DDL: `POST /v1/postgres/databases/{db}/schemas/public/tables` | Working | 201 | Auto-injects `tenant_id` column, RLS policy, grants |
| DDL requires `nullable:false` on PK column | Expected | 400 `DDL_INVALID` if missing | Validation enforced |
| Data: `POST .../tables/lc_items/rows` `{id:1, name:"test-item"}` | Working | 201 `{item:{...tenant_id:"676c519b-..."}, access:{rlsEnforced:true}}` | RLS enforced; tenant_id auto-stamped |
| Data: `GET .../tables/lc_items/rows` | Working | 200 `{items:[{id:1, name:"test-item", tenant_id:"676c519b-..."}]}` | Row returned with tenant scoping |
| MongoDB: `POST /v1/mongo/workspaces/{ws}/data/{db}/collections/{coll}/documents` | Working | 201 `{item:{...tenantId:"676c519b-..."}, insertedId:...}` | TenantId auto-stamped |
| MongoDB: `GET .../documents/{id}` | Working | 200 `{found:true, item:{tenantId:"676c519b-..."}}` | Document found |

### Workspace deletion

| Test | Status | HTTP | Notes |
|---|---|---|---|
| `DELETE /v1/tenants/{id}/workspaces/{wsId}` | Not-deployed | 404 `NO_ROUTE` | Route not mapped |
| `DELETE /v1/workspaces/{wsId}` (catalog route) | Not tested | 401 (KC down) | Route exists in catalog; JWT required |

### Tenant purge cascade

Already confirmed in C1: `POST /v1/tenants/{id}/purge` returns `{purged:true, removed:{workspaces:N, databases:[], realm:...}}`.

### Data isolation probes

| Probe | Expect | Actual | Status |
|---|---|---|---|
| TB API key `GET .../lc_items/rows` against TA workspace | 403 | 403 `FORBIDDEN: Credential workspace does not match` | PASS |
| Trust-header TB-tenant against TA workspace | 403 | 403 `CROSS_TENANT_VIOLATION: Workspace does not belong to caller's tenant` | PASS |
| TB API key `GET .../mongo/.../lc_items_mongo` against TA workspace | 403 | 403 `FORBIDDEN: Credential workspace does not match` | PASS |
| Trust-header TB-tenant against TA mongo | 403 | 403 `CROSS_TENANT_VIOLATION` | PASS |

---

## SUMMARY TABLE

| Cap | Functionality | Status |
|---|---|---|
| C1 | List tenants (superadmin) | Working |
| C1 | GET single tenant | Working (note: response field duplication) |
| C1 | Create tenant | Working |
| C1 | Delete tenant | Working |
| C1 | Purge tenant (cascade) | Working |
| C1 | Isolation (cross-tenant GET/list) | PASS |
| C2 | List users under tenant | Working |
| C2 | Create user under tenant | Working |
| C2 | Isolation (cross-tenant users) | PASS |
| C3 | List workspaces | Working |
| C3 | GET single workspace | Not-deployed (NO_ROUTE at /v1/tenants/{id}/workspaces/{wsId}) |
| C3 | Create workspace | Working |
| C3 | Delete workspace | Not-deployed (NO_ROUTE at /v1/tenants/{id}/workspaces/{wsId}) |
| C3 | Isolation (cross-tenant workspace list) | PASS |
| C4 | Environment catalog view | Working (/v1/tenants/{id}/environments) |
| C4 | Environment as workspace field | Working |
| C4 | Isolation | PASS |
| C5 | List plans | Working |
| C5 | Create plan (with slug) | Working |
| C5 | Activate plan (lifecycle) | Working |
| C5 | Assign plan to tenant | **Broken — P1 BUG-C5-INT-OVERFLOW** |
| C5 | GET effective entitlements | Working (catalog defaults) |
| C5 | GET consumption | Working |
| C5 | GET allocation summary | Working |
| C5 | GET plan history | Working (empty — no assignments ever succeeded) |
| C5 | Isolation (cross-tenant entitlements) | PASS |
| C28 | max_workspaces quota enforced (402) | Working |
| C28 | Rate-limit (429) | Not tested (KC down, JWT required) |
| C29 | plan_audit_events populated with corr IDs | Working |
| C29 | quota_enforcement_log populated on deny | **Broken — P2 BUG-C29-NO-ENFORCEMENT-LOG** |
| C29 | scope_enforcement_denials populated on 403 | **Broken — P2 BUG-C29-NO-SCOPE-DENIAL-LOG** |
| C29 | /v1/metrics/…/audit-records GW route | Not-deployed |
| C30 | Workspace create + DB provisioned | Working |
| C30 | Postgres DDL API (create table w/ RLS) | Working |
| C30 | Postgres data API (insert/read rows) | Working |
| C30 | MongoDB insert/read | Working |
| C30 | Data isolation (API key bound to WS) | PASS |
| C30 | Data isolation (trust-header cross-tenant) | PASS |
| C30 | Workspace delete | Not-deployed (via tenants path) |

---

## BUGS

### BUG-C5-INT-OVERFLOW (P1 — Plan Assignment Always 500)

**Repro:** `POST /v1/tenants/{id}/plan {"planId":"...", "assignedBy":"..."}` with any active plan.  
**Symptom:** HTTP 500 `22003 Internal server error`  
**Root cause:** `plan-change-history-repository.mjs:insertQuotaImpacts()` inserts `observedUsage` / `previousEffectiveValue` / `newEffectiveValue` into `tenant_plan_quota_impacts.observed_usage INTEGER` column. The usage collector for `storage_bytes_used` returns values in bytes (5 GB = 5,368,709,120) which exceeds `INTEGER` max (2,147,483,647). Migration `100-plan-change-impact-history.sql` declares all three columns as `INTEGER NULL` instead of `BIGINT`.  
**Impact:** No plan can ever be assigned to any tenant. All plan-based quota enforcement, entitlements (beyond catalog defaults), and plan billing are completely non-functional.  
**Fix:** Change `INTEGER` to `BIGINT` in migration `100-plan-change-impact-history.sql` for `previous_effective_value`, `new_effective_value`, `observed_usage` columns.

### BUG-C1-RESPONSE-DUP (P3 — GET/CREATE Tenant Response Has Duplicate Fields)

**Repro:** `GET /v1/tenants/{id}` or `POST /v1/tenants`.  
**Symptom:** Response body contains the tenant object both under `.tenant` AND directly at root level (e.g. `{tenant:{id,slug,...}, id:..., slug:..., ...}`).  
**Impact:** Clients that access `.id` vs `.tenant.id` see different code paths; any consumer using the root fields instead of `.tenant` will break if the handler is fixed.

### BUG-C29-NO-ENFORCEMENT-LOG (P2 — Quota Enforcement Not Logged)

**Repro:** Trigger a `QUOTA_EXCEEDED` (402) by attempting to create a 4th workspace when limit is 3.  
**Symptom:** `quota_enforcement_log` table has 0 rows.  
**Root cause:** The quota enforcement check returns HTTP 402 but does not write to the audit log. The log table schema exists and has the right columns (`decision`, `correlation_id`, etc.) but is never populated.  
**Impact:** No audit trail of quota denials; compliance gap.

### BUG-C29-NO-SCOPE-DENIAL-LOG (P2 — Cross-Tenant Denials Not Logged)

**Repro:** Make a cross-tenant request (e.g. acme-ops `GET /v1/tenants/globex-id`) → 403.  
**Symptom:** `scope_enforcement_denials` table has 0 rows despite repeated 403s being returned.  
**Impact:** No audit trail of authorization failures; compliance gap.

---

## RELIABILITY FINDING

### FIND-KC-OOM (P1 — Keycloak OOM Restart Loses All Realm Data)

**Observed:** Keycloak pod (`falcone-keycloak-65d655bd54-rb7f5`) OOM-killed (exit 137) at ~16:15 UTC (21 min after install). After restart, all KC realms are gone (no PVC). All JWT-based management endpoints return `INVALID_CREDENTIALS` / `Realm does not exist`.  
**Impact:** Complete loss of authentication for all tenant users and superadmin. Requires manual re-bootstrapping of KC via `provision-platform-realm.sh` + `seed.mjs`.  
**Mitigation:** Give Keycloak a PersistentVolumeClaim (or use external DB like PG for KC) so realm data survives pod restarts.

---

## NOT-DEPLOYED

- `GET /v1/tenants/{id}/workspaces/{wsId}` — no route at this path (catalog has `/v1/workspaces/{id}`)
- `DELETE /v1/tenants/{id}/workspaces/{wsId}` — no route at this path
- `GET /v1/metrics/tenants/{id}/audit-records` — not registered in APISIX gateway
- `GET /v1/observability/quota-audit` — no gateway route
- `GET /v1/observability/scope-enforcement` — no gateway route
- Workspace rate-limit (429 via APISIX `limit-count` plugin) — not tested (KC down)

## COULDN'T TEST

- C5 isolation for consumption routes (globex-ops → acme entitlements) — KC outage prevented fresh JWT
- C28 rate-limit (429) enforcement — requires JWT (KC down)
- C29 `/v1/metrics/*` audit-record HTTP endpoints — not registered in APISIX; 401 on access  
- C30 `DELETE /v1/workspaces/{id}` — JWT required; KC down after create test
- Workspace `lc-ws-16829` cleanup — not cleaned (requires JWT, KC down); left in cluster

## ISOLATION VERDICT

**PASS on all tested vectors.** Every cross-tenant probe returned 403:

- `FORBIDDEN: cannot read another tenant` (tenant management)
- `FORBIDDEN: requires superadmin or tenant owner/admin` (workspace/user/environment management)
- `FORBIDDEN: Credential workspace does not match` (API key data-plane)
- `CROSS_TENANT_VIOLATION: Workspace does not belong to caller's tenant` (trust-header data-plane)
- `FORBIDDEN` (plan/entitlements endpoints)

Tenant isolation is enforced at multiple layers: JWT claims, API key workspace binding, and trust-header cross-tenant check in the executor.
