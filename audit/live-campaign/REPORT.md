# Falcone — Live End-to-End Functionality & Isolation Campaign

**Date:** 2026-06-18 · **Cluster:** kind `test-cluster-b` (ns `falcone`) · **Method:** empirical only — every
result is an actual call against the running system (HTTP/SSE responses, datastore queries, pod logs),
never code review alone. Evidence per capability under `audit/live-campaign/evidence/20-…27-*.md`.

## How this run was done (single fresh install)

- **Clean teardown + fresh install, once.** `tests/live-campaign/teardown.sh` removed the release, namespace,
  PVCs and cluster-scoped objects; all 4 app images + the workflow-worker were **rebuilt from current HEAD**;
  `install.sh` did a health-gated from-scratch install (datastores → control-plane → keycloak → apisix → ferretdb
  → executor → functions RBAC). Advanced caps (Temporal/Flows + MCP + realtime) were layered on the same install.
- **CRITICAL methodology correction.** The first probes ran against **stale, node-cached images** because the
  rebuild reused the tag `campaign-20260617` while pods use `imagePullPolicy: IfNotPresent` — kind kept the 9h-old
  image. After forcing fresh pulls (`imagePullPolicy: Always` + restart), **F1/F3/F4/D5/A2/A4 — all "bugs" the
  prior campaign reported — turned out to be FIXED at HEAD** (see §6). Every finding below was (re)confirmed on
  genuinely-fresh HEAD images.
- **Fixtures (≥2 tenants).** `acme` (78848e21…) and `globex` (fe63fa39…), each with owner + alice + bob +
  `<slug>-ops` (platform-realm tenant operator carrying `tenant_id` + `tenant_owner`), **two projects** (`app-staging`,
  `app-prod`) each with its own `wsdb_<tenant>_<ws>` Postgres DB, Kafka topics, minted API keys, and an app end-user.

## Stack under test (post-migration) — PASS

| Component | Expected | Found | Verdict |
|---|---|---|---|
| Document DB | FerretDB/DocumentDB (mongo-wire), NOT MongoDB | FerretDB **v2.7.0** + DocumentDB; `buildInfo`→`ferretdb v2.7.0`; no MongoDB server | **PASS** |
| Object storage | SeaweedFS, NOT MinIO | seaweedfs master/volume/filer/s3; no MinIO | **PASS** |
| Functions | Knative, NOT OpenWhisk | real per-fn Knative `ksvc` (scale-to-zero); no OpenWhisk | **PASS** |
| Secrets | Vault (pre-OpenBao) | **Vault NOT deployed/wired** on kind (cert-manager absent); apps read native k8s Secrets | finding DEP-VAULT |

No MongoDB / MinIO / OpenWhisk workloads exist (confirmed twice on the live cluster).

---

## 1. Headline

- **Tenant isolation — MIXED (TOP-PRIORITY result).** Strong, empirically-proven isolation on **Postgres row data,
  Storage REST API, Flows/MCP/Realtime, and Auth/realms**. But **confirmed cross-tenant breaches** on **Events/Kafka
  (P0)**, **Functions compute (P0)**, **Metrics (P0)**, **Mongo document/browse (P1)**, **Postgres metadata browse
  (P1)**, and **direct S3 (P1)**. The common root is the kind **control-plane's browse/list/metrics handlers omit the
  tenant filter** that the executor data-plane enforces, plus per-tenant **compute/storage identities not deployed**.
- **Core BaaS works end-to-end:** tenant/project provisioning (saga + cascade purge), Postgres data API (DDL+CRUD,
  per-workspace DBs + FORCE RLS), Storage object I/O (REST + direct SeaweedFS), Events publish/consume (SSE),
  Functions deploy/invoke (real Knative), Realtime PG change-stream (SSE, tenant-isolated), API-key issuance
  (cross-tenant now correctly rejected), per-tenant Keycloak realms + app end-user register→login→token.
- **Workflows (Temporal) — engine PROVEN, data activity not wired.** A flow created→published→executed reached a
  terminal Temporal state (real workflow run); the `db.query` activity returns "postgres executor not wired".
- **MCP hosting works; tool execution + MCP→workflow + platform-MCP do not.** Servers create/list/publish/curate
  fine; every tool-call returns the executor index page; the MCP→workflow module is orphaned.
- **Governance is largely broken:** plan-assignment/capability-catalog/scope-audit 500 on missing tables, the quota
  dimension catalog is empty, and **per-project quotas are not enforced**. Audit store is empty.
- **Advanced caps are executor-only:** APISIX exposes no `/v1/flows` or `/v1/mcp` route (gateway-config gap).

---

## 2. Functionality status matrix

Legend: **Working** = exercised E2E with passing assertions · **Partial** · **Broken** = deployed but errors ·
**Not-deployed** = no live backing in this profile.

| # | Capability | Surface(s) | Status | Key evidence |
|---|---|---|---|---|
| C1 | Tenant lifecycle (create/list/get/delete/purge-cascade) | REST | **Working** | create 201 (saga: realm+DB+rows); purge → realm 404, DB+rows gone |
| C2 | Tenant users | REST | **Working** | POST/GET `/tenants/{id}/users` 201/200 (tenant realm) |
| C3 | Projects (workspaces) create/list | REST, Console | **Partial** | create 201 (→ real `wsdb_*`); **no GET/DELETE route**; **quota not enforced** |
| C4 | Environments (prod/staging/dev) | REST | **Working (as field)** | per-workspace `environment∈{dev,staging,prod,sandbox,preview}`; `/environments` aggregates; no first-class env CRUD |
| C5 | Plans / quotas / entitlements | REST | **Broken** | reads empty 200; plan-assign **500**, capability-catalog **500**, dimension catalog empty, no enforcement |
| C6 | Console/superadmin auth (sessions) | REST→KC | **Working** | login-sessions 201 with tokenSet; refresh/logout present |
| C7 | AuthZ (roles) | REST | **Working** | superadmin vs tenant_owner enforced; (operator console shell mis-gated — C33) |
| C8 | IAM admin (realms/users/roles/groups) | REST | **Working (superadmin)** | list/create users/roles 200/201; end-user **delete/disable unrouted** |
| C9 | Auth-method templates + per-project config | KC, REST | **Partial** | templates are a chart `tenantRealmTemplate` + runtime provisioner (not first-class KC objects); social-IdP enable/reflect/disable works via KC admin; **no Falcone API for IdP/auth-method config** |
| C10 | App end-user register→login→token→authorized call | KC, REST | **Working (HEAD)** | new tenant: register 201 → ROPC token (un-forgeable `tenant_id`) → resource 200 `rlsEnforced`; social round-trip not run (no real IdP creds) |
| C11 | Owner manages app end-users | REST | **Partial** | list/view ok; **disable/delete have no Falcone API** |
| C12 | Service accounts + API keys (issue/rotate/revoke) | REST/EXEC | **Working** | issue 201; **cross-tenant issuance now 403** (F1 fixed) |
| C13 | Postgres data API (DDL + CRUD + vector) | EXEC (apikey), Console browse | **Working** | DDL 201 (auto tenant_id col + FORCE RLS + policy); CRUD all 2xx; vector **not-deployed** (no pgvector/provider) |
| C14 | Direct PostgreSQL (scoped) | psql/pg | **Working** | per-ws `wsdb_*` DBs; `falcone`/`falcone_service`/`falcone_anon` non-superuser+non-BYPASSRLS |
| C15 | Mongo/FerretDB data API (CRUD) | EXEC (apikey) | **Working (after NP fix)** | scoped insert 201 (auto `tenantId`); blocked by a NetworkPolicy label defect until fixed (BUG-MONGO-NP) |
| C16 | Direct FerretDB (mongo driver) | mongo wire | **Working** | admin auth ok (F2 fixed); one shared cluster, tenancy by `tenantId` field |
| C17 | Object storage REST (buckets/objects/usage) | REST | **Working** | provision/list/put/get/list/delete/usage all 2xx |
| C18 | Direct S3/SeaweedFS (scoped) | S3 SDK | **Working (single shared cred)** | put/get/list ok; **one shared root identity** (no per-tenant identities) |
| C19 | Events/Kafka (topic/publish/consume SSE) | REST | **Working** | create 201, publish 202, SSE frames delivered |
| C20 | Functions (Knative: deploy/invoke/result/logs) | REST | **Working** | deploy 201, invoke→`{doubled:42}`, real ksvc; **input must be `{parameters:{…}}`** (BUG) |
| C21 | **Event-driven (Kafka→fn/workflow)** | REST+Kafka | **Not working E2E** | event→function trigger not-deployed; event→flow trigger registers but execution blocked |
| C22 | **Workflows (Temporal/Flows)** | EXEC | **Engine working; db.query broken** | create→publish→execute→Temporal WorkflowExecutionStarted confirmed; `db.query` UPSTREAM_UNAVAILABLE (worker missing PG env vars — BUG-C22-A); isolation PASS |
| C23 | **MCP server hosting** | EXEC | **Working (internal API); MCP JSON-RPC not exposed** | create/list/publish/curate/tool-call 2xx; tool routes to data plane (confirmed); MCP Streamable HTTP (initialize/tools/list) 404 NO_ROUTE; isolation PASS |
| C24 | **MCP → workflow** | EXEC | **Working end-to-end** | `run_flow_*` tool auto-generated from `resources.flows`; tool-call → 201 Running Temporal execution (executionId confirmed in Temporal) |
| C25 | **Falcone platform MCP interface** | EXEC | **Present, non-functional** | "official" server exposes 9 mgmt tools; tool-calls return index page |
| C26 | **Realtime** (PG change-stream SSE) | EXEC | **Working + isolated** | subscribe→`event: insert` with tenant row; A sees only A's rows. WebSocket **not-deployed** (SSE only); Mongo realtime off (501) |
| C27 | Secrets/config (Vault) | — | **Not-deployed** | Vault not viable on kind; no component reads Vault |
| C28 | Quotas / plan governance enforcement | REST | **Not enforced** | created 4 workspaces past `max_workspaces=3` → all 201 |
| C29 | Audit logging | REST | **Broken/empty** | audit-records empty; scope-enforcement audit **500** (missing table) |
| C30 | Provisioning lifecycle (create+delete+cleanup) | REST | **Partial** | create + tenant-purge-cascade work; **no workspace teardown API** |
| C31 | Metrics (Prometheus + Grafana) | scrape/UI | **Partial** | Prometheus up (only 3 targets, APISIX down); Grafana 2 dashboards w/ real data |
| C32 | API↔Console parity & completeness | REST+Console | **Consistent but incomplete** | created resources match across surfaces; several console pages have no reachable backend |
| C33 | Web console admin surface | Console (replayed) | **Partial** | superadmin pages work; **operator shell broken** (tenant-switcher calls superadmin-only route); leaky read pages |
| C34 | CDC (pg/mongo) | — | **Not-deployed** | no cdc-bridge pods |
| C35 | Webhooks | EXEC | **Present (flows trigger)** | webhook trigger route exists; dead without flow execution |
| C36 | Scheduling/cron | — | **Not-deployed** | no scheduling pod/handler reachable |
| C37 | Backup/restore | REST | **Partial** | read-only scope routes; backup-scope 500 (missing table); no execute/restore |

---

## 3. ISOLATION RESULTS (Phase 3 — TOP PRIORITY)

≥2 tenants (acme/globex), each with 2 projects (prod/staging). For every resource created as A we attempted access
as B (and vice-versa) through every surface.

### 3a. Isolation that HOLDS (empirically proven)

| Surface | Probe | Result |
|---|---|---|
| **Postgres row data** | A-key→B-ws rows; B-key→A-ws; cross-ENV staging→prod; DB-name confusion | **all 403/deny**; A's confidential row lives only in `wsdb_acme_app_staging`; FORCE RLS fails closed |
| **API-key issuance** (F1) | acme-ops mint key in globex ws | **403 CROSS_TENANT_VIOLATION** (fixed) |
| **Storage REST API** | A→B bucket/object get/put/delete/usage | **404/401**, no existence leak, victim object intact |
| **Flows / MCP / Realtime** | A→B flow/server; realtime A vs B in same table | **403/404**; realtime per-tenant NOTIFY channel — A's stream got only A's row |
| **Auth / realms** | acme token → globex realm users; cross-realm login; cross-tenant end-user JWT→resource | **403 / invalid_grant / 403** (tenant_id from verified issuer, un-forgeable) |
| **Control-plane mutations** | cross-tenant workspace create / plan assign / quota override | **403** |

### 3b. Isolation BREACHES (confirmed cross-tenant access)

| ID | Sev | Surface | Empirical repro |
|---|---|---|---|
| **ISO-EVENTS** | **P0** | Events/Kafka | tenant-A JWT → read B's topic detail/metadata (200), **publish into B's topic** (202), **consume B's topic via SSE** (got the events). Bidirectional. Root: `kafka-handlers::getTopicByResourceId` has no tenant scope. |
| **ISO-FUNCTIONS** | **P0** | Functions compute | `ksvcName = fn-{workspaceName}-{action}` omits tenant; both tenants have a `app-staging` ws → B's deploy clobbered A's shared ksvc; A invoked its own function and got **B's code's output** (`OWNED_BY:tenantB`). All fn ksvcs share one namespace. |
| **ISO-METRICS** | **P0** | Metrics | acme-ops → `/v1/metrics/tenants|workspaces/{globex…}/*` all **200**; `/metrics/workspaces/{globex-ws}/series` returned globex's **real non-empty `http_requests_per_second`** series. Even a non-existent tenant id → 200. No tenant authz on metrics handlers. |
| **ISO-MONGO** | **P0** | Document store | acme-ops JWT (gateway) → `GET …/data/{globexDb}/collections/{c}/documents` → **200 returning globex's doc** (`secret:"GLOBEX_PRIVATE"`); `?filter=` exfiltration works; browse lists all tenants' db/collection names. Root: control-plane mongo browse/list handlers omit `tenantId` (the executor path scopes correctly). |
| **ISO-PG-META** | **P1** | Postgres metadata | acme-ops → `GET /v1/postgres/databases` lists **every tenant's DBs + the platform `in_falcone`**; `…/{globexDb}/schemas|tables|columns` enumerable. `pgListDatabases` scans `pg_database` cluster-wide. Metadata only (row data stays RLS-protected). |
| **ISO-S3** | **P1** | Direct S3 | one shared SeaweedFS identity (`falcone-s3-admin`) = the only credential; with it I listed **both** tenants' buckets, read globex's object, and **wrote** into globex's bucket (appeared in globex's own REST listing). No per-tenant S3 identities deployed. |
| **ISO-QUOTA-READ** | **P2** | Quota reads | acme-ops → `/v1/tenants/{globex}/quota/{effective-limits,audit}` → **200** (empty now, but unauthorized). |

**Verdict:** request-path **mutations** and the **executor data-plane** are correctly tenant-scoped; the **read/browse/metrics handlers in the kind control-plane** and the **shared datastore identities** (S3, FerretDB admin) are the cross-tenant exposure.

---

## 4. Bugs (deployed but broken) — beyond the isolation breaches above

| ID | Sev | Finding |
|---|---|---|
| BUG-MONGO-NP | P1 | cp-executor pod label `app=falcone-cp-executor` ≠ FerretDB NetworkPolicy ingress (`app.kubernetes.io/name=control-plane-executor`) → executor mongo CRUD **500** until the label is fixed. (`deploy/kind/executor-demo.yaml`.) |
| BUG-GOV-SCHEMA | P1 | governance schema incomplete: capability-catalog **500** (`boolean_capability_catalog`), plan-assign **500** (`tenant_plan_change_history`), scope-enforcement audit **500** (`scope_enforcement_denials`), empty `quota_dimension_catalog`. |
| BUG-QUOTA-ENFORCE | P1 | per-project/workspace quota **not enforced** (4 ws created past `max_workspaces=3`). |
| BUG-ENDUSER-MGMT | P1 | no Falcone API to disable/delete app end-users (owner routes are create+list only). |
| BUG-CONSOLE-OPERATOR | P1 | console shell unusable for tenant operators: tenant-switcher calls `GET /v1/tenants` (superadmin-only) → 403 → no tenant context → tenant pages empty; My-plan/Members also 403. |
| BUG-FLOWS-ACTIVITY | P1 | workflow `db.query` activity returns "postgres executor not wired" → workflows can't perform data ops (engine itself works). |
| BUG-EVENTDRIVEN | P1 | Kafka→function/workflow not working E2E: event→function trigger not-deployed; event→flow trigger registers but execution blocked. |
| BUG-MCP-TOOLCALL | P2 | MCP tool-call execution returns the executor index page (`MCP_SELF_BASE_URL` unset + route gaps); MCP→workflow module orphaned; platform-MCP tools non-functional. |
| BUG-AUDIT | P2 | audit store empty/not-deployed; scope-enforcement audit 500. |
| BUG-FN-INVOKE-PARAM | P2 | `fnInvoke` reads `body.parameters`; top-level input silently dropped (`{n:21}`→`{doubled:0}`). |
| BUG-STORAGE-BINARY | P2 | object PUT accepts only JSON `{content,…}`; rejects raw/binary (`400 INVALID_JSON`) → not S3-PUT compatible. |
| BUG-PG-INSERT-CONTRACT | P2 | insert `{row:{…}}` (per OpenAPI) → 400; executor reads `values`/`changes`. |
| BUG-MONGO-INDEX-500 | P2 | `…/collections/{c}/indexes` on a missing collection → 500 (leaks Mongo code 26). |

## 5. Deployment / infra findings (surfaced by the mandated fresh install)

| ID | Sev | Finding |
|---|---|---|
| DEP-BOOTSTRAP | P2 | Keycloak bootstrap **Job fails on a cold fresh install** (`backoffLimit:1`, KC not Ready on the single retry). The logic is correct (re-running the pod provisions realm+roles+clients+superadmin and completes) — not robust to the cold-start race; blocks governance config. |
| DEP-VAULT | P2 | Vault not a working secrets backend on kind (cert-manager absent → enabling it aborts the release); no component reads from Vault. |
| DEP-GW-ROUTES | P2 | APISIX has **no `/v1/flows` or `/v1/mcp` route** → Flows + MCP unreachable through the gateway (executor-direct only). `/v1/websockets/*` has no handler. |
| DEP-IMAGE-PULL | P2 | **(harness)** same image tag + `IfNotPresent` runs stale node-cached images; install must use unique tags or `imagePullPolicy: Always`. Also `make-secrets.sh` pre-created `in-falcone-gateway-shared-secret` which the chart now self-manages → helm ownership conflict (fixed by letting the chart own it). |
| DEP-PROM-SCRAPE | P2 | Prometheus scrapes only 3 targets (APISIX down / others not scraped). |
| DEP-WS-DELETE | P2 | no workspace GET/DELETE API (only tenant purge cascades) → can't tear down a single project. |
| DEP-TEMPORAL-SA | P2 | hand-deployed dev Temporal needs the 5 custom search attributes registered (the chart's `temporal-bootstrap` Job does this); otherwise flow execution 500s. |
| DEP-TENANT-SCOPES | P2 | chart `tenantRealmTemplate.requiredClientScopes` not applied to tenant realms (template drift). |

## 6. CORRECTED — prior-campaign findings that are FIXED at HEAD

These were reported by the previous campaign as bugs; on genuinely-fresh HEAD images they are **fixed** (the prior
results were on pre-fix / stale-cached code):

- **F1** cross-tenant API-key issuance IDOR → **403 CROSS_TENANT_VIOLATION** (`resolveWorkspaceTenant`, #517/#534).
- **F2** FerretDB/Mongo auth → admin connect + scoped CRUD **work**.
- **F3** `GET /v1/plans` → **200**; **F4** metrics quotas → **200** (plan/quota tables now created by the CP schema boot).
- **D5** control-plane schema migration no-retry → fixed (`schema ready … (attempt N)`).
- **A2** console clients missing `roles` scope → fixed (default scopes present). **A4** platform user-profile drops
  `tenant_id` → fixed (declared attribute). **A3** tenant-realm token issuance → fixed (`createTenant` creates the
  `{slug}-app` public client + un-forgeable `tenant_id` mapper; our acme/globex fixtures lack it only because they
  were seeded on the stale image before the refresh).

### Additional corrections from evidence-rerun (2026-06-18 — C22–C26 re-tested with P1 fixes applied)

- **C23 MCP tool-calls** — Previously reported as "returns executor index". Rerun confirms tool-calls route correctly to the data plane (`{"name":"query_items","arguments":{}}` → 200 with real data-plane result). `MCP_SELF_BASE_URL` and `/rows` path were already fixed (#566–#572).
- **C24 MCP→workflow** — Previously reported as "Gap / mapping orphaned". Rerun confirms `generateFromFlows()` is wired, `run_flow_*` tools are auto-generated, and a tool-call triggers a real Temporal workflow execution (executionId returned + confirmed in Temporal history). Fix landed as part of #566–#572.
- **BUG-C22-A (new P1):** Worker missing PG env vars (`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) → `db.query` fails with UPSTREAM_UNAVAILABLE indefinitely. Root: Helm overlay for `workflowWorker.env` not applied to the deployed pod.
- **BUG-C22-B (new P1):** Temporal custom search attributes not auto-registered on fresh install (bootstrap Job stanza not applied) — manually registered during campaign.
- **BUG-C22-D (new P0 security):** DDL executor without workspace context silently creates objects in platform DB (`in_falcone`) instead of the tenant's workspace DB. Fail-closed guard absent.

## 7. What could not be fully tested (and why)

- **Social OAuth round-trip:** no real external IdP credentials — verified the config surface + available-options
  reflection only.
- **Vector search:** no pgvector image + no embedding provider configured → not-deployed (not a bug).
- **Real browser console drive-through:** Playwright chromium binary unavailable → console verified by enumerating the
  SPA routes + replaying the exact `/v1/*` calls each page makes (the console is a thin SPA over the API).
- **A clean SUCCESSFUL workflow data activity:** the engine runs but `db.query` is "not wired" in the deployed worker.
- **CDC / scheduling / backup-execute:** not deployed in this profile (expected-but-absent gaps, not silent skips).

## 8. Reproducibility / harness (feature branch)

`tests/live-campaign/`: `teardown.sh`, `build-images.sh`, `push-images.sh`, `make-secrets.sh` (gateway-secret fix),
`values-campaign.yaml`, `install.sh`, `advanced-caps.sh` (Temporal/worker/MCP), `provision-ops-users.sh` (platform
tenant operators), `complete-fixtures.mjs`, `lib/{client.mjs,creds.sh,portforward.sh,pf-all.sh}`, `seed.mjs`,
`run-tests.mjs`. Per-capability empirical evidence: `audit/live-campaign/evidence/20…27-*.md`. Secret-bearing files
(`.fixtures.json`, kubeconfig) are gitignored; no secret values appear in any artifact.
</content>
