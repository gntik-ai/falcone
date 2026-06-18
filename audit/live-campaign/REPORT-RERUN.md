# Falcone — Live E2E Functionality & Isolation Campaign (RE-RUN 2026-06-18)

**Cluster:** kind `test-cluster-b`, ns `falcone` · **Method:** empirical only — every result is an actual call against
the running system (HTTP/SSE responses, datastore queries, Kafka broker state, pod logs). **Install:** all 5 app images
rebuilt from current `main` HEAD (post P0/P1/P2 merges #547–#577) under a unique tag `head-20260618`; full teardown +
from-scratch install, ONCE. Evidence: `audit/live-campaign/evidence-rerun/*.md`.

> This run RE-VERIFIES the prior campaign's merged fixes on a clean HEAD install and surfaces what is still broken /
> newly broken. Headline: the prior **API-reachable cross-tenant data-leak P0s are FIXED and HOLD**; the remaining
> isolation issues are **structural collisions** (slug-derived names) and **shared/inactive datastore identities**, plus
> a **critical Keycloak-persistence infra defect** that took the whole auth plane down mid-run.

---

## 0. Stack under test — PASS (clean HEAD, no legacy components)

| S# | Expected | Found | Verdict |
|----|----------|-------|---------|
| S1 | FerretDB/DocumentDB, NOT MongoDB | `ghcr.io/ferretdb/ferretdb` (**buildInfo → v2.7.0**) + postgres-documentdb; **no mongodb workload** | **PASS** |
| S2 | SeaweedFS, NOT MinIO | seaweedfs master/volume/filer/s3; **no minio workload** | **PASS** |
| S3 | Knative, NOT OpenWhisk | knative-serving + kourier; real per-fn ksvc; **no openwhisk** | **PASS** |
| S4 | Vault (pre-OpenBao) | `vault.enabled=false` on kind (no cert-manager); apps read native k8s Secrets | DEP-VAULT (expected — not a migration gap) |

App images deployed: control-plane / cp-executor / web-console / workflow-worker all `…:head-20260618` (clean-HEAD proven).

---

## 1. Headline

- **Tenant isolation (TOP PRIORITY) — STRONG on data, with structural gaps.** Empirically proven isolation on: tenant
  & workspace management (403), API-key cross-tenant issuance (403 CROSS_TENANT_VIOLATION) and key→other-workspace data
  (403), **Postgres row data (FORCE RLS, fail-closed)**, Mongo data API (403/empty), metrics (403), **events executor
  apiKey path**, **functions executor path**, **realtime** (A sees only A's rows), and app end-user tokens
  (issuer-bound to the tenant realm; rejected by the mgmt API). The prior P0 data-leaks (#547–#550, #534) are **fixed
  and hold**.
- **Residual / new isolation defects (all P1, none a clean API data-leak):**
  (a) **events** control-plane path keys the physical Kafka topic by the non-unique workspace **slug** → same-slug
  cross-tenant collision + second-tenant lockout; (b) **storage** bucket registry `ON CONFLICT(bucket_name)` hijacks
  `tenant_id` for slug-derived bucket names; (c) **executor DDL** trust-header (gateway-bypass) path executes DDL on any
  named DB incl. the platform `in_falcone` (the tenant-facing **apiKey path is confined** — no tenant-to-tenant leak);
  (d) **per-tenant SeaweedFS identities are not active** → a single shared admin S3 credential.
- **CRITICAL infra defect — Keycloak has no persistence.** KC runs **H2 in-memory, no PVC, no external DB**; it was
  **OOMKilled** (exit 137, 2Gi limit) ~26 min in under multi-tenant test load and **lost every realm** (platform +
  tenant). This is a total, self-inflicted auth outage + data loss on any restart. It also blocked several JWT-path
  tests mid-run (see §7).
- **Core BaaS works end-to-end:** tenant/project provisioning (real per-workspace PG DBs + Kafka topics + saga +
  cascade purge), PG data API (DDL+CRUD), Mongo data API (CRUD), Storage object I/O (REST + direct SeaweedFS, incl.
  binary), Events (executor path), Functions (real Knative deploy/invoke/activations), Realtime (PG change-stream SSE),
  API keys (issue/rotate/revoke), per-tenant Keycloak realms + app-client + app end-user login (un-forgeable tenant_id).
- **Advanced caps improved vs prior run:** **MCP hosting works**, **MCP→workflow works end-to-end** (a tool-call starts
  a Temporal workflow), **Realtime works + isolated**. Temporal **engine runs** flows to terminal state. Remaining
  gaps: workflow `db.query` activity (worker missing PG env), platform-MCP HTTP route, MCP JSON-RPC protocol surface.
- **Governance/lifecycle defects:** plan assignment 500 (INTEGER overflow → no tenant can hold a plan); scheduling 500
  (handler not in the image); flow/webhook triggers 502 (missing DB tables); audit enforcement logs never written.

---

## 2. Functionality status matrix

Legend: **Working** (E2E pass) · **Partial** · **Broken** (deployed, errors) · **Not-deployed** (no live backing).

| # | Capability | Status | Key evidence |
|---|---|---|---|
| C1 | Tenant lifecycle (create/list/get/delete/purge-cascade) | **Working** | create 201 (realm+DB+rows), purge cascades; response dup root+`.tenant` (P3) |
| C2 | Tenant users | **Working** | POST/GET `/tenants/{id}/users` 201/200 |
| C3 | Projects/workspaces create/list | **Partial** | create 201 → real `wsdb_*`; single-ws GET/DELETE not-deployed (route is `/v1/workspaces/{id}`) |
| C4 | Environments | **Working** | `environment` is a ws field + `/tenants/{id}/environments` aggregate (dev/staging/prod/sandbox/preview) |
| C5 | Plans/quotas/entitlements | **Broken (assign)** | reads OK; **plan assign → 500 INTEGER overflow** (no tenant can hold a plan) |
| C6 | Console/superadmin auth | **Working** | login-sessions 201 tokenSet; refresh 200; logout 200 (until KC crash) |
| C7 | AuthZ roles | **Working** | superadmin vs tenant_owner enforced; cross-tenant 403 |
| C8 | IAM admin | **Partial** | list/create users+roles, disable/delete OK; getIamUser / role-by-name / realm-CRUD routes 404 (in catalog, unwired) |
| C9 | Auth templates + per-project config | **Partial** | per-tenant realm + `{slug}-app` client provisioned; social IdP addable via KC admin; **no Falcone API for IdP/auth-method config** |
| C10 | App end-user register→login→token | **Partial** | login works (ROPC 200, un-forgeable tenant_id); **register API drops the password** (`credentialTypes=[]`) |
| C11 | Owner manages app end-users | **Partial** | superadmin can list/disable/delete; **tenant_owner cannot list its own end-users (403, superadmin-only)**; no dedicated end-user API |
| C12 | Service accounts + API keys | **Working** | issue/rotate(old key 401)/revoke(401); cross-tenant issuance 403 |
| C13 | Postgres data API (DDL+CRUD+vector) | **Working (quirks); vector blocked** | CRUD all 2xx + auto tenant_id + FORCE RLS; DDL needs `columnName/dataType`, `primaryKey` makes no PK; **`CREATE EXTENSION vector` → "extension not available"** — the bitnami PG image lacks pgvector; the chart ships a `pgvector/pgvector` image as the install path (kind profile doesn't use it) |
| C14 | Direct PostgreSQL (scoped) | **Working** | per-ws `wsdb_*`; `falcone` non-superuser+non-BYPASSRLS; FORCE RLS cross-tenant read → 0 rows |
| C15 | Mongo/FerretDB data API | **Working (quirks)** | CRUD + auto tenantId; provision-db needs `name` not `databaseName`; aggregation/admin-sql not-deployed |
| C16 | Direct FerretDB | **Working** | `buildInfo` → ferretdb v2.7.0; one shared cluster, tenancy by `tenantId` |
| C17 | Object storage REST | **Working** | provision/list/put(incl. **binary**, #554)/get/list/delete/usage all 2xx |
| C18 | Direct S3/SeaweedFS | **Working (shared cred)** | put/get/list ok; **single shared admin identity** — per-tenant identities NOT active (SRN-2) |
| C19 | Events/Kafka | **Working (executor) / collision (CP)** | executor `evt.<wsId>.<t>` isolated; control-plane `ws.<slug>.<t>` collides across same-slug tenants |
| C20 | Functions (Knative) | **Working** | deploy/invoke→result/activations; real ksvc; per-(tenant,ws) namespacing; `{source.inlineCode}` invoke bug (P2) |
| C21 | **Event-driven (Kafka→fn/flow)** | **Broken/Not-deployed** | Kafka→function trigger not-deployed; event→flow trigger 502 (missing `flow_trigger_*` tables) |
| C22 | **Workflows (Temporal/Flows)** | **Engine working; data activity broken** | flow create→publish→execute→terminal state; `db.query` → UPSTREAM_UNAVAILABLE (worker missing PG env) |
| C23 | **MCP server hosting** | **Working** | create/list/publish/curate + tool-call routes to data-plane; isolated (403) |
| C24 | **MCP → workflow** | **Working** | `run_flow_*` tool-call → Temporal WorkflowExecutionStarted, returns result |
| C25 | **Platform MCP interface** | **Not-deployed** | `mcp-official-server.mjs` exists; no HTTP route in `server.mjs` |
| C26 | **Realtime (PG change-stream SSE)** | **Working + isolated** | subscribe→`event: insert` with tenant row; A sees only A's rows; WS not-deployed (SSE only) |
| C27 | Secrets/config (Vault) | **Partial** | Vault is **deployable on kind** via `vault.tls.mode` (≠cert-manager) but **no app reads Vault** (apps read native k8s Secrets); tenant config-mgmt routes exist (`/v1/admin/config/format-versions` reachable; `config/export\|validate` → 404 unwired) |
| C28 | Quota enforcement | **Working** | `max_workspaces=3` enforced; 4th create → **402 QUOTA_EXCEEDED** |
| C29 | Audit logging | **Partial** | `plan_audit_events` populated w/ correlation; `quota_enforcement_log` + `scope_enforcement_denials` never written |
| C30 | Provisioning lifecycle | **Partial** | create + purge-cascade work; no single-workspace teardown API |
| C31 | Metrics (Prometheus + Grafana) | **Partial** | Prom 4/5 targets UP (APISIX target DOWN); Grafana 3 dashboards real data; Falcone metrics API 200 |
| C32 | API↔Console parity | **Partial** | data-plane pages consistent; 3 operator pages call superadmin-only routes (403); `/v1/console/session` 404 |
| C33 | Web-console admin | **Partial** | SPA serves; operator shell partly works; my-plan/plans/tenants 403 for operators (not role-gated) |
| C34 | CDC (pg-captures) | **Broken (gateway gap)** | handler IS deployed (`PgCaptureLifecyclePublisher.mjs`); `GET /v1/realtime/workspaces/{ws}/pg-captures` needs a JWT **and** gateway-injected identity headers — APISIX provides neither for this path → **401**; the realtime PG change-stream (C26, the actual CDC data path) **works** |
| C35 | Webhooks | **Broken** | ingestion route HMAC-fail-closed (401); publish with webhook trigger → 502 (missing tables) |
| C36 | Scheduling/cron | **Broken** | `/v1/scheduling/*` → 500 ERR_MODULE_NOT_FOUND (handler not COPY'd in Dockerfile) |
| C37 | Backup/restore | **Broken (missing schema)** | `GET /v1/admin/backup/scope` reachable as superadmin → **500 `42P01`** (missing `deployment_profile_registry`/`backup_scope_entries`); `services/backup-status/*` exists; cross-tenant → **403** |

---

## 3. ISOLATION RESULTS (Phase 3 — TOP PRIORITY)

≥2 tenants (acme/globex), 2 projects each (app-staging/app-prod). For every resource created as A, accessed as B (and
vice-versa) across every surface.

### 3a. Isolation that HOLDS (empirically proven)
| Surface | Probe | Result |
|---|---|---|
| Tenant/workspace/plan/quota mgmt | acme-ops → globex tenant/ws/entitlements/quota/metrics | **403** all |
| API-key issuance | acme-ops mint key in globex ws | **403 CROSS_TENANT_VIOLATION** |
| API-key → data | key A → B's ws data (PG & Mongo) | **403 FORBIDDEN** |
| Postgres rows | B key/GUC → A rows; cross-env staging→prod | **0 rows / 403**; FORCE RLS fail-closed |
| Mongo documents (browse) | acme-ops JWT → globex documents | **404 / empty**, no GLOBEX content (prior #550 holds) |
| Metrics | acme-ops → globex workspace series/overview | **403** (prior #549 holds) |
| Events (executor apiKey) | key A → B's topic | **403**; physical topic `evt.<wsId>.<t>` |
| Functions (executor apiKey) | key A → B's action | **403**; per-(tenant,ws) ksvc |
| Realtime | A subscription vs B inserts | A receives only A's rows; cross-tenant 403 |
| App end-user token | A end-user (tenant-realm JWT) → mgmt API | **401** (issuer-bound; not a mgmt principal); cross-tenant 401 |
| MCP / flows | A → B server/flow | **403 CROSS_TENANT_VIOLATION** |

### 3b. Isolation weaknesses / structural defects (all P1)
| ID | Surface | Empirical finding |
|---|---|---|
| **FIND-EVENTS-SLUG-COLLISION** | Events (control-plane JWT path) | acme & globex both `POST collide-events` to their `app-staging` ws → **identical** resourceId `res_topic_80c2db4e` + **identical** physical `ws.app-staging.collide-events` (one shared Kafka topic). 2nd tenant then 404s on its own topic. Not an API data-leak (id-scope guard 404s B), but a cross-tenant resource collision + lockout + JWT/apiKey path divergence. |
| **FIND-STORAGE-BUCKET-COLLISION** | Storage REST | two tenants' slug-derived bucket name `ws-app-staging-assets` collide; `insertBucket` `ON CONFLICT(bucket_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id` → first tenant's registry row hijacked (their bucket vanishes from their list). |
| **FIND-DDL-TRUST-BOUNDARY** (A7, corrected P0→P1) | Executor DDL | trust-header (gateway-bypass, no workspace) DDL executes on the literal URL `{db}` incl. **platform `in_falcone`** (`lchack_nows` created there). **Tenant-facing apiKey path is CONFINED** to its own ws DB (targeting `in_falcone`/globex lands in acme's own DB — no tenant-to-tenant leak). Defense-in-depth gap + `GATEWAY_SHARED_SECRET` unset on the executor. |
| **FIND-STORAGE-NO-TENANT-IDENTITIES** (SRN-2) | Direct S3 | per-tenant SeaweedFS identities not active (`STORAGE_TENANT_IDENTITIES` absent from the deployed control-plane env); every provision returns `storageCredential:null`; one shared admin cred reads/writes all tenants' buckets. |

Direct datastore admin creds (PG admin, FerretDB admin, S3 admin) can read all tenants — expected for the *admin*
credential; the application credential (`falcone`) is RLS-confined on Postgres.

---

## 4. Findings (deployed-but-broken / infra) — beyond §3b

| ID | Sev | Finding | Source |
|----|-----|---------|--------|
| **FIND-KC-NO-PERSISTENCE** | **P0** | Keycloak H2 in-memory, no PVC/DB → OOMKilled (exit137, 2Gi) ~26min in, **all realms lost** (total auth outage + data loss on any restart) | verified |
| **FIND-DDL-TRUST-BOUNDARY** | P1 | executor DDL trust-path → platform DB (§3b) | verified |
| **FIND-EVENTS-SLUG-COLLISION** | P1 | events slug-collision (§3b) | verified |
| **FIND-STORAGE-BUCKET-COLLISION** | P1 | bucket registry tenant_id hijack (§3b) | agent |
| **BUG-PLAN-INT-OVERFLOW** | P1 | plan assign → 500; `tenant_plan_quota_impacts.observed_usage` is INTEGER, usage in bytes overflows → no tenant can hold a plan | agent |
| **BUG-SCHEDULING-DOCKERFILE** | P1 | `/v1/scheduling/*` → 500 ERR_MODULE_NOT_FOUND; `scheduling-management.mjs` referenced in route-map but **not COPY'd in `apps/control-plane/Dockerfile`** | agent |
| **BUG-FLOW-TRIGGER-SCHEMA** | P1 | `flow_trigger_registrations` / `flow_trigger_secrets` tables missing → event→flow + webhook triggers 502 | agent |
| **BUG-WORKER-PG-ENV** | P1 | workflow worker missing PGHOST/PGUSER/PGPASSWORD/PGDATABASE → `db.query` activity UPSTREAM_UNAVAILABLE | agent |
| **BUG-TEMPORAL-SEARCH-ATTRS** | P1 | dev Temporal custom search attributes not auto-registered on fresh install | agent |
| **BUG-IAM-CREDENTIALS-DROP** | P1 | `POST /v1/iam/realms/{realm}/users` ignores the `credentials` array → app end-users created without a password (cannot log in) | verified |
| **BUG-ENDUSER-OWNER-403** | P1 | tenant_owner cannot list its own app end-users (`GET /v1/iam/realms/{id}/users` → 403 superadmin-only) | agent |
| **FIND-STORAGE-NO-TENANT-IDENTITIES** | P1 | per-tenant S3 identities inactive (env flag dropped) (§3b) | verified |
| **DEP-SWFS-NETPOL** | P1 | seaweedfs internal-only netpol blocks the upstream bucket-hook on enforcing CNIs → fresh `helm install` hangs (chart wrongly assumes kind doesn't enforce NetworkPolicy) | verified |
| **BUG-DDL-CONTRACT** | P2 | create-table needs `columnName/dataType` (not `name/type`); `primaryKey:true` emits no PK constraint | agent |
| **BUG-MONGO-PROVISION-FIELD** | P2 | mongo db provision needs body `name` (not `databaseName`) → 400 | agent |
| **BUG-FN-INLINECODE** | P2 | executor deploy `{source:{inlineCode}}` → invoke error (source object not unwrapped) | agent |
| **BUG-FN-INVOKE / BUG-BULK-PATH** | P2 | route catalog bulk path `…/bulk/insert` vs executor `…/rows/bulk/insert` | agent |
| **BUG-CONSOLE-MYPLAN** | P2 | `/console/my-plan` 403 for tenant_owner (calls superadmin-only `/tenants/{id}/plan`); operator pages not role-gated | agent |
| **BUG-CONSOLE-SESSION** | P2 | `/v1/console/session` referenced in SPA → 404 (unimplemented) | agent |
| **BUG-AUDIT-ENFORCE-EMPTY** | P2 | `quota_enforcement_log` + `scope_enforcement_denials` never written despite 402/403 firing | agent |
| **BUG-IAM-ROUTES-UNWIRED** | P2 | `getIamUser`, `getIamRole`/`deleteIamRole`, realm-CRUD in catalog → 404 | agent |
| **BUG-METRICS-APISIX-TARGET** | P2 | Prometheus APISIX scrape target DOWN (returns HTML, not metrics) | agent |
| **DEP-HEALTHGATE** | P2 | install.sh health gate false-negatives (`apisix /health` 404 — `/v1/*` routes fine; ferretdb smoke blocked by netpol but reachable from executor) | verified |
| **BUG-APIKEY-SCHEMA / BUG-TENANT-DUP** | P3 | apikey list snake_case vs mint camelCase; tenant object duplicated root+`.tenant` | agent |

---

## 5. Deployed-but-broken / gated (CORRECTED — these were re-tested at their real route-map paths/auth)
> Methodology correction: initial passes mis-tested several capabilities at guessed paths and wrongly called them
> "not-deployed". Re-testing against `deploy/kind/control-plane/route-map.runtime.json` paths with correct auth shows
> they are **deployed but broken or gated**, which is the more accurate (and more actionable) finding:
- **CDC pg-captures (C34):** handler deployed; unreachable via the gateway (no identity-header injection) → 401. *Finding G5.*
- **Backup/restore (C37):** reachable as superadmin → 500 `42P01` (missing schema). *Finding C6.*
- **Vector search (C13):** chart supports it via the `pgvector/pgvector` image; the kind profile's bitnami PG lacks it → `CREATE EXTENSION vector` "not available". *Finding E3.*
- **Vault/secrets (C27):** Vault is deployable on kind via `vault.tls.mode` (≠cert-manager), but **no Falcone component reads from Vault** (apps consume native k8s Secrets) → the "secrets via Vault" capability is unwired regardless of whether the pod runs. *Finding G6.*

**Genuinely absent (no deployable component / route):** Mongo aggregation + admin-SQL (executor 404), Kafka→function
trigger, MCP JSON-RPC/Streamable-HTTP protocol surface, single-workspace GET/DELETE, `/v1/websockets/*` handler.

## 6. Prior-campaign P0/P1 fixes — re-verified on clean HEAD
- **#547 events IDOR** (id-scope guard) → holds (cross-tenant topic id → 404). Residual: slug collision (new P1).
- **#548 functions ksvc tenant-namespacing** → holds (per-(tenant,ws) ksvc; executor cross-tenant 403).
- **#549 metrics tenant authz** → holds (cross-tenant metrics 403).
- **#550 mongo browse scope** → holds (cross-tenant docs 404/empty).
- **#534 cross-tenant API-key issuance** → holds (403 CROSS_TENANT_VIOLATION).
- **#558 bootstrap cold-start** → holds (bootstrap Job Completed on a cold fresh install).
- **#554 storage binary PUT** → holds. **#570 fn top-level input** → holds.

## 7. What could not be fully tested (and why)
- **Several JWT-path re-tests + C10 social-login** were interrupted by **FIND-KC-NO-PERSISTENCE** (KC OOM wiped realms
  ~26min in). The executor/apiKey data-plane isolation was fully proven; the control-plane handler isolation was proven
  pre-crash (403s). The platform realm was restored from the chart's OWN bootstrap payload (no config patch) to
  complete C10 end-to-end (login + un-forgeable tenant_id + issuer-bound isolation). KC memory was NOT patched
  (out-of-scope env fix) — so the OOM remains a live finding.
- **Social OAuth round-trip:** no real external IdP creds — config/redirect surface only.
- **Vector search:** no pgvector image + no embedding provider — not-deployed.
- **CDC / backup / platform-MCP protocol:** not deployed in this profile (expected-but-absent, not silent skips).
