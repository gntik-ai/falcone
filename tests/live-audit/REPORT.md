# Falcone — Live-Stack Empirical Functionality & Isolation Audit

**Target:** running Falcone deployment on the local **kind** cluster `test-cluster-b`, namespace
`falcone`, Helm release `in-falcone-0.3.0` (rev 47). Every result below was produced by exercising
the **running system** (real REST calls, real DB/Mongo/S3 clients, real Kafka, real function
invocations) and observing actual responses — no static "should work" claims. Reproduction scripts
and raw evidence live under `tests/live-audit/specs/` and `tests/live-audit/evidence/`.

**Date:** 2026-06-16 · **Branch:** `test/live-stack-empirical-audit` · gateway-bypass via
`kubectl port-forward` (NodePorts unreachable from the test host).

---

## 0. Headline

> **Tenant isolation — the cardinal requirement for a multitenant BaaS — is NOT enforced on the
> live deployment.** Cross-tenant **read + write + delete** was empirically demonstrated with real,
> correctly-scoped tenant credentials on **Postgres, Kafka events, and Functions**, plus
> source-confirmed IDOR on **Storage**. Worse, the **API gateway (APISIX) does not authenticate
> data-plane requests** — an **unauthenticated** caller impersonates **any tenant** by setting a
> single `x-tenant-id` header (proven: minted an API key for Tenant A with no credentials). The
> management plane *is* authenticated; the data plane is not. See §4.
>
> Scope note: the gateway bypass is reachable by any in-cluster client today; external reachability
> is currently inert only because **no ingress controller is deployed** (the `*.dev.in-falcone…`
> Ingress objects don't route) — i.e. it becomes internet-facing the moment the intended ingress is
> turned on. The Mongo data API and the Realtime/CDC streams are the only surfaces that scope by the
> **verified credential's tenant** and do **not** leak.

Functionally, the core data-plane is **partially working and inconsistent**: schema/DDL, document
insert/list, event publish/consume, function invoke, storage provisioning, governance/quota reads,
auth-as-a-service signup, and Keycloak admin auth all work; but the **Postgres data round-trip is
broken**, **document by-id CRUD is broken**, **auth-as-a-service login is broken**, **quota
consumption isn't measured**, and **object I/O, secrets, team management, workflows, MCP, and
FerretDB-wiring are not deployed**.

---

## 1. Method & environment

- **Auth:** superadmin token via Keycloak `in-falcone-platform` realm (ROPC, `in-falcone-console`),
  issuer forced to the in-cluster host so the control-plane accepts it → control-plane mgmt API.
  Data-plane via **minted `flc_` API keys** (real credential path) and the executor **trust-header**
  path. Secrets read from cluster (authorized) at runtime, never embedded/printed.
- **Fixtures (≥2 tenants, multiple projects/envs):** 9 tenants exist; primary pair used —
  **Tenant A = "Ops Demo"** (`ffd33d99…`, ws `9dfb3614…`, db `wsdb_ops_demo_0610_ops_ws`) and
  **Tenant B = "DataPlane Demo"** (`a5db1fad…`, ws `7d155cef…`, db `wsdb_dp_demo_0510_primary`),
  both realm-backed and data-plane-provisioned.
- **Stack present:** APISIX gateway, control-plane + cp-executor, Postgres, **SeaweedFS** (wired),
  Kafka, Keycloak, Knative (+ 1 function), web-console, platform Prometheus/Grafana/Loki/Jaeger.
- **Architecture note (verified):** the data-plane connection registry's `resolveConnection` is a
  constant ignoring `workspaceId` → **all workspaces share the `in_falcone` database**; the
  per-workspace `wsdb_*` databases are orphaned. The document API points at **legacy
  `falcone-mongodb`** (FerretDB deployed but not wired). No Temporal, MCP engine, or OpenBao.

---

## 2. Functionality status matrix

Legend: ✅ Active/Working · 🔴 Broken · 🟡 Partial · ⬜ Not-deployed/in-flight

| Capability | Surface | Status | Note |
|---|---|---|---|
| Platform/superadmin OIDC auth | REST | ✅ | Keycloak platform realm; JWT accepted by CP |
| Tenant mgmt (list/get/capabilities) | REST | ✅ | `dashboard` 404 (advertised-unwired) |
| Plans / entitlements / quota limits | REST | ✅ | reads work |
| Quota **consumption** measurement | REST | 🔴 | all `currentUsage:null`, `CONSUMPTION_QUERY_FAILED` |
| Quota audit trail | REST | ✅ | |
| Postgres DDL (schema/table/index) | REST | ✅ | needs `nullable:false`+`constraints.primaryKey` |
| Postgres **data CRUD round-trip** | REST | 🔴 | API-created tables → `TABLE_NOT_FOUND` (no grant/RLS) |
| Postgres direct (psql, scoped) | direct | 🟡 | shared `in_falcone`; per-ws DB unused |
| Document insert / list | REST | ✅ | tenant-filtered |
| Document **by-id** get/update/delete | REST | 🔴 | `_id` ObjectId queried as string → silent no-op |
| Document aggregation/bulk/txn/streams | REST | ⬜ | NO_ROUTE |
| Direct Mongo (driver, scoped) | direct | 🟡 | co-mingled in one collection, tenantId field only |
| FerretDB wired into data API | — | ⬜ | API uses legacy mongo |
| Storage bucket provision/list/usage | REST | ✅ | real SeaweedFS |
| Storage **object I/O (put/get/del)** | REST | ⬜ | NO_ROUTE — only direct S3 works |
| Direct S3 (SeaweedFS) | direct | 🟡 | single shared key sees all tenants |
| Functions invoke (+ activations/logs) | REST | ✅ | executor (dev runner) + Knative both invoke→result |
| Functions deploy | REST | ✅ | executor in-memory store |
| Events/Kafka create/publish/consume | REST | ✅ | per-ws topic prefix `evt.<ws>.<topic>` |
| **Kafka→function** trigger | REST | ⬜ | no trigger/rule wiring (NO_ROUTE) |
| **Kafka→workflow** | — | ⬜ | Temporal not deployed |
| Auth-as-a-service signup | REST | ✅ | 201 |
| Auth-as-a-service **login→token** | REST | 🔴 | "Account is not fully set up" |
| End-user per-tenant realm isolation | — | 🔴 | users land in shared platform realm |
| API key issue/list/rotate/revoke + guard | REST | ✅ | revoke + key-mgmt guard enforced |
| RBAC: memberships/invitations/custom roles | REST | ⬜ | NO_ROUTE |
| Keycloak realm roles/users | REST | ✅ | |
| Secrets/config (OpenBao) | — | ⬜ | not deployed |
| Metrics: Falcone app/tenant data | obs | 🔴 | 0 app metrics scraped; API returns zeros |
| Metrics: infra Grafana | obs | 🟡 | stack up; no Falcone dashboards |
| Realtime CDC — Postgres table (SSE) | REST | ✅ | insert/update/delete pushed; **isolation holds** |
| Realtime CDC — Mongo collection (SSE) | REST | 🟡 | insert/update pushed; **DELETE never delivered** (RT-1); isolation holds |
| Create tenant / workspace (project) | REST | 🟡 | metadata created; workspace **physical DB not provisioned** (PROV-1) |
| Multiple environments per project | — | 🔴 | not a concept — workspace-slug only |
| Delete/purge tenant + cascade cleanup | REST | 🔴 | **not wired** (404) → orphans, no offboarding (PROV-2) |
| Web console (admin pages, login) | UI | ✅ | superadmin login + tenants/workspaces/plans/iam render real data |
| Console edge-routability (as deployed) | UI | 🔴 | no ingress controller; same-origin `/v1` calls unrouted (CONS-3) |
| API ↔ console parity | UI/REST | ✅ | thin client; lists/fields match; API-created tenant shows in UI |
| Workflows (Temporal) / MCP / FerretDB-wired | — | ⬜ | not deployed; green-when-deployed (Temporal/FerretDB); MCP unwired |

---

## 3. Per-capability results (evidence files)

- **Postgres data API + isolation** → `evidence/03-postgres-and-isolation.md`
  DDL works; data round-trip broken (no grant/RLS on API-created tables); **cross-tenant
  read/write/delete proven**; shared `in_falcone` DB; `falcone_service` can reach control-plane
  tables.
- **Document / Mongo** → `evidence/04-document-mongo.md`
  insert/list active & tenant-filtered (no read leak); **by-id ops broken** (P1); advanced features
  not-deployed; **FerretDB not wired** (legacy mongo); isolation soft/field-based.
- **Storage / S3** → `evidence/05-storage-s3.md`
  provision/list/usage active; **object I/O not deployed**; **single shared S3 key = all tenants**;
  handlers ignore `identity` → bucket/workspace IDOR (source-confirmed).
- **Functions + Events** → `evidence/06-functions-events.md`
  invoke→result proven (executor + Knative); Kafka publish/consume proven; **Kafka→function and
  Kafka→workflow not deployed**; **FE-1 cross-tenant** (events/functions by path) proven.
- **Auth-as-a-service + governance** → `evidence/09-auth-and-governance.md`
  signup works; **login broken**; **end-users in shared platform realm**; quota **consumption
  broken**; plans/quota/audit reads active.
- **API keys / RBAC / secrets** → `evidence/10-rbac-keys-secrets.md`
  key lifecycle active & enforced; team mgmt + secrets/OpenBao not deployed.
- **Metrics / observability** → `evidence/13-metrics.md`
  metrics API returns zeros; Falcone Prometheus scrapes nothing; no Falcone dashboards.
- **Gateway + systemic authz (isolation)** → `evidence/15-gateway-and-executor-authz.md`
  see §4.

---

## 4. Isolation campaign (TOP PRIORITY) — results

Every probe used **two real tenants** and attempted cross-tenant access through each surface.

| # | Surface | Result | Proof |
|---|---|---|---|
| **GW-1** | Public gateway (APISIX) | 🔴 **CRITICAL** unauth impersonation | no-auth + spoofed `x-tenant-id` through APISIX → minted a key for Tenant A (201), listed A's keys; without header → 401 |
| **PG-1** | Postgres data API | 🔴 **CRITICAL** read+write+delete | B's key read `TENANT-A-CONFIDENTIAL`, inserted `PLANTED-BY-TENANT-B`, deleted A's row |
| **FE-1** | Kafka events / Functions | 🔴 **CRITICAL** read+write | B's key listed A's topics, published into A's topic `evt.<A_ws>.…`, invoked A's function |
| **STOR** | Storage / S3 | 🔴 **HIGH** IDOR + shared key | handlers ignore `identity.tenantId`; one shared SeaweedFS key reads/writes every tenant's objects |
| **FE-2** | Knative function (control-plane) | 🟠 **HIGH** unscoped | function routes `auth:'authenticated'` only; `getFnAction` has no `tenant_id` predicate |
| **AAS-2** | Identity / Keycloak | 🟠 **HIGH** co-mingling | self-service end-users created in the shared platform realm, not the tenant realm |
| Mongo | Document API | 🟢 no read leak | executor injects `tenantId` filter (B sees `[]`); but namespace caller-controlled, co-mingled physically |

**Systemic root cause (AUTHZ-1):** data-plane handlers authorize by the **URL path identifier**
(`workspaceId`/`databaseName`/`bucketId`) and never assert it belongs to the authenticated
credential; the gateway neither authenticates nor strips client tenant headers; and Postgres
collapses all workspaces into one shared database with no RLS on user tables. Full analysis +
reproduction in `evidence/15-gateway-and-executor-authz.md`.

**Cross-surface parity / completeness note:** the live runtime implements only a fraction of the
advertised OpenAPI surface (`public-route-catalog.json` = 392 routes); many advertised routes return
`NO_ROUTE` (dashboard, object I/O, function secrets/triggers, memberships, aggregation, mongo admin).
This is a REST↔spec completeness gap that also affects REST↔console parity (§6).

---

## 5. Event-driven integration (explicit requirement)

- **Kafka publish→consume**: ✅ proven (publish `{hello:world,n:42}` → consumed identically).
- **Kafka → function**: ⬜ **NOT DEPLOYED** — no trigger/rule wiring; `…/triggers`, `…/rules`,
  `/actions/{id}/kafka-triggers` all `NO_ROUTE`; no background Kafka→function consumer in code.
- **Kafka → workflow engine**: ⬜ **NOT DEPLOYED** — no Temporal/flows on the live stack.
  → An event does **not** trigger a workflow or a function end-to-end on the live deployment. Each
  half (event bus, function invoke) works in isolation; the binding between them is absent.

## 6. API ↔ Console parity
_Pending console agent — see §3 update on completion._ Structural note: the console is a thin SPA
over the same control-plane API, so parity is bounded by the same REST completeness gaps in §4.

## 9. In-flight / not-deployed features (→ `evidence/14-inflight-features.md`)
Classified **not-deployed, not bugs** (per the brief):
- **Workflows (Temporal/Flows)** — not deployed live (`/v1/flows` NO_ROUTE, no Temporal). Tested
  **green-when-deployed**: 8 real-run Playwright specs (design/publish, triggers, run/observe,
  failure-retry, human-approval, version-pinning, worker-kill durable-resume, cross-tenant) +
  `values-flows-e2e.yaml`/`stack.sh` deploy logic. No broken-when-deployed evidence.
- **MCP server hosting** — not deployed AND **not wired into `runtime/server.mjs`** (the #391–#399
  modules are pure/unintegrated); the 3 specs self-skip. Neither green nor broken — "not-yet-wired."
- **FerretDB document path** — a **wiring gap**: FerretDB + DocumentDB pods are up, but the live data
  API still targets legacy `falcone-mongodb`. 10 ephemeral specs green on the FerretDB overlay
  (CRUD + pgvector + cross-tenant); txn spec skipped (FerretDB 2.7 limitation, not a Falcone bug).
- Caveat: **CI does not run the kind Playwright suites** — "green-when-deployed" rests on the
  deploy-ready suites + merge history, not a CI gate.

## 7. Realtime / CDC (→ `evidence/08-realtime.md`) — WORKING, isolation HOLDS
Both SSE change streams are deployed and were proven empirically (subscribe → mutate → frame captured):
- **Postgres table** (trigger + LISTEN/NOTIFY): insert/update/**delete** all delivered with full row. ✅
- **Mongo collection** (change stream on a 1-node replica set): insert/update delivered; **delete
  events never arrive (RT-1, P2)** — pre-images aren't populated so the `$match` delete branch drops
  them (dropped, never leaked; stale-cache risk).
- **Isolation HOLDS on both:** B subscribing to A's path (B's key) received **nothing**; A's own
  stream saw the events. Scope is the **verified API-key tenant** (mongo `$match` on
  `fullDocument.tenantId`; pg per-tenant NOTIFY channel `flc_rt_<md5(schema.table:tenant_id)>`), not the
  URL path — i.e. this surface implements the correct pattern the broken surfaces (§4) lack.

## 8. Provisioning lifecycle (→ `evidence/11-provisioning-lifecycle.md`)
- **Create:** `POST /v1/tenants` creates a metadata row (no realm/workspace auto-provisioned);
  `POST /v1/workspaces` creates a workspace + `workspace_databases` registry row + async saga.
- **PROV-1 (MED):** the workspace's **physical Postgres database is never provisioned** — new
  workspaces get a registry row with no backing `wsdb_*` DB (only the two long-lived demo workspaces
  have real DBs). Combined with the shared-`in_falcone` runtime, per-workspace DBs are unused *and*
  uncreated.
- **Environments:** not a first-class concept — an "environment" is only a workspace slug; no isolated
  per-environment resource set. Multiple isolated environments per project = **not supported**.
- **PROV-2 (HIGH):** **tenant deletion/purge is not wired** (`DELETE /v1/tenants/{t}` and `/purge` →
  404). No offboarding, no cascading cleanup → orphaned (potentially cross-tenant) data with no
  remediation path. (Probe tenants had to be removed by direct SQL.)

## 6. Web console + API↔console parity (→ `evidence/12-console-parity.md`) — WORKS; parity HOLDS
- The console is a static thin SPA (`/v1/*` same-origin). **Superadmin login works end-to-end**
  (`POST /v1/auth/login-sessions → 201` → `/console/overview`); overview/tenants/workspaces/plans/
  iam-access/members all render real data with zero JS errors (11 screenshots captured).
- **Parity HOLDS:** tenant dropdown == `GET /v1/tenants`; plan table == `GET /v1/plans`; a tenant
  created via the API appeared in the console on reload. No consequential console-only/API-only fields.
- **CONS-1 (MED):** the UI "new tenant" wizard POSTs to `/v1/admin/tenants` → **404** (only
  `/v1/tenants` exists) — UI-driven tenant creation fails.
- **CONS-3 (MED, deployment):** the console is **not edge-routable as deployed** — no ingress
  controller exists, so the SPA's same-origin `/v1/*` calls have nothing routing them to the
  control-plane (a real browser on the console host would get HTML for every API call). The agent
  worked around this with Playwright request-rewriting to APISIX.
- **CONS-4 (follow-up, isolation):** console tenant scoping is **client-side only** (filters the full
  `/v1/tenants` list). For superadmin this is correct; whether `GET /v1/tenants` is **server-side
  scoped for a non-superadmin tenant principal** could not be confirmed (no tenant-scoped console user
  exists). If the API returns all tenants to a tenant user, the console would only cosmetically hide
  them. **Open management-plane isolation question — flagged for follow-up.**
- Positive: the **management API is authenticated at the gateway** (`GET`/`POST /v1/tenants` without
  auth → 401, even via APISIX) — unlike the data-plane executor (GW-1).

---

## 10. What could not be (fully) tested
- **Tenant-scoped JWT** to the data plane: the executor only verifies **platform-realm** JWTs and
  platform users carry no `tenant_id`; tenant-realm tokens aren't accepted. Data-plane principal
  testing therefore used API keys + trust headers (which is itself the GW-1/AUTHZ-1 finding).
- **NodePorts** were unreachable from the host → all access via `kubectl port-forward`.
- Items marked ⬜ are **not-deployed/in-flight**, not failures (Temporal, MCP, OpenBao, FerretDB
  wiring, object I/O, function triggers, team management) — not filed as bugs.
