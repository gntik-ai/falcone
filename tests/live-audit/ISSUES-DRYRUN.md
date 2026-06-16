# Proposed OpenSpec epics & GitHub issues — DRY RUN (no issues created yet)

Grouped into epics with child issues, formatted to the repo conventions (OpenSpec change-id +
labels). **Nothing is created until you confirm.** Labels use the repo set: `bug`/`enhancement`,
`P0|P1|P2`, `cap:<name>`, `security`/`tenant-isolation`, `openspec`, `e2e` (where relevant).

Severity scale: **P0** = exploitable cross-tenant breach / data loss · **P1** = core capability
broken or high-impact isolation gap · **P2** = correctness/observability gap.

---

# EPIC A — Tenant isolation is not enforced on the live stack (CRITICAL)
**Labels:** `epic` `security` `tenant-isolation` `P0` `cap:multitenancy`
**Problem:** With two real tenants, cross-tenant **read/write/delete** was empirically demonstrated
on Postgres, Kafka events and Functions, plus IDOR on Storage; and an **unauthenticated** caller can
impersonate any tenant via the public gateway. The cardinal BaaS guarantee is absent.
**Children:** A1–A6. **Acceptance (epic):** the isolation spec suite
(`tests/live-audit/specs/*` cross-tenant probes) passes deny-by-default on every surface; a tenant
credential can only ever touch its own resources; the gateway authenticates and strips tenant headers.

## A1 — Gateway: authenticate requests and strip client tenant-context headers
- **change-id:** `fix-gateway-authn-and-strip-tenant-headers` · **Labels:** `bug` `security` `tenant-isolation` `P0` `cap:gateway` `openspec`
- **Problem:** The live standalone APISIX (`falcone-apisix-standalone`, public via
  `api.dev.in-falcone.example.com`) carries only `cors`+`proxy-rewrite` — **no auth plugin** and **no
  rule stripping client `x-tenant-id`/`x-workspace-id`**. The executor trusts those headers when no
  credential is presented, so the gateway is an open door.
- **Evidence/repro:** `POST http://<apisix>/v1/workspaces/<A_ws>/api-keys` with header
  `x-tenant-id: <A_tenant>` and **no Authorization** → **201**, minted a service key for Tenant A;
  `GET …/api-keys` with the same header → 200 (A's keys). Without the header → 401.
  (`evidence/15-gateway-and-executor-authz.md`.)
- **Proposed solution:** wire the intended `openid-connect`/JWT verification + `key-auth` on APISIX
  routes; have the gateway **strip inbound `x-tenant-id`/`x-workspace-id`/`x-auth-subject`** and inject
  them only from the verified token; remove the executor's header-trust fallback (or gate it to a
  mutually-authenticated in-cluster network).
- **Acceptance:** an unauthenticated request with a spoofed `x-tenant-id` → 401 at the gateway;
  client-supplied tenant headers never reach the backend; valid JWT/API-key still works.
- **Depends on:** A2 (defense-in-depth). **Affected capability:** gateway / authn.
- **Scope note:** the bypass affects the **data-plane** routes (the executor catch-all); the
  management plane (`/v1/tenants`, …) already requires auth (401). Reachable by any in-cluster client
  now; external exposure is currently inert only because no ingress controller is deployed.

## A2 — Executor: bind every data-plane op to the credential's workspace (not the URL path)
- **change-id:** `fix-executor-enforce-credential-workspace` · **Labels:** `bug` `security` `tenant-isolation` `P0` `cap:data-plane` `openspec`
- **Problem:** Handlers take `workspaceId`/`databaseName`/`bucketId` from the **path** and never assert
  it matches the authenticated credential (`identity.workspaceId === path.workspaceId`). A correctly
  scoped Tenant-B credential operates on Tenant-A resources.
- **Evidence/repro:** with **B's own service key** on **A's** path: events — listed A's topics and
  published into `evt.<A_ws>.…`; functions — invoked A's function; (`evidence/06-functions-events.md`,
  `evidence/15-…`). Postgres breach is A2+A3 combined.
- **Proposed solution:** centralize an authorization check that the path `workspaceId`/`databaseName`
  resolves to the credential's tenant/workspace; reject (403) otherwise; apply uniformly to postgres,
  mongo, events, functions, realtime, api-keys.
- **Acceptance:** B's key on A's path → 403 on every data-plane verb; B's key on B's path → works.
- **Affected capability:** data-plane (postgres/events/functions/realtime).

## A3 — Postgres: real per-workspace DB isolation + RLS on user tables
- **change-id:** `fix-postgres-tenant-db-isolation-and-rls` · **Labels:** `bug` `security` `tenant-isolation` `P0` `cap:database` `openspec`
- **Problem:** `apps/control-plane/src/runtime/main.mjs:57` `resolveConnection = () => ({ dsn })`
  ignores `workspaceId` → **all workspaces share `in_falcone`** (the control-plane metadata DB); the
  provisioned `wsdb_*` databases are orphaned. User tables created via the DDL API have **no RLS** and
  are owned by `falcone`; the shared `falcone_service` role can read across tenants.
- **Evidence/repro:** `tests/live-audit/specs/03-postgres-isolation.sh` — Tenant B read
  `TENANT-A-CONFIDENTIAL`, inserted a row, and **deleted** A's row, all via B's own key; response
  `access:{rlsEnforced:false,reason:"grant_only"}`. `falcone_service` has SELECT on
  `public.workspace_api_keys` (all tenants).
- **Proposed solution:** make `resolveConnection` return the real per-workspace DSN from the data-plane
  provisioner (the registry already supports it); OR if staying single-DB, enforce schema-per-workspace
  + `FORCE ROW LEVEL SECURITY` with `tenant_id`/`workspace_id` policies on every table and revoke broad
  `falcone_service` grants on control-plane tables.
- **Acceptance:** B's key cannot see/modify A's table; data API never connects to `in_falcone` for
  tenant data; `falcone_service` has no SELECT on control-plane tables.
- **Affected capability:** database (Postgres data API).

## A4 — Storage: enforce bucket ownership + per-tenant S3 identity
- **change-id:** `fix-storage-bucket-ownership-and-identity` · **Labels:** `bug` `security` `tenant-isolation` `P0` `cap:storage` `openspec`
- **Problem:** `deploy/kind/control-plane/storage-handlers.mjs` `listObjects(ctx.params.bucketId)` /
  `workspaceUsage(ctx.params.workspaceId)` never reference `identity.tenantId` → IDOR. The platform
  uses **one shared SeaweedFS admin credential**; no per-tenant S3 identity or bucket policy.
- **Evidence/repro:** `evidence/05-storage-s3.md` — handlers serve any bucket/workspace by id; the
  single shared key read both `tenant-A-secret` and `tenant-B-secret` object payloads directly.
- **Proposed solution:** check bucket/workspace ownership against the caller's tenant on every storage
  route; issue per-tenant SeaweedFS identities + bucket policies (or per-tenant prefixes enforced
  server-side); stop handing out a platform-wide key.
- **Acceptance:** a tenant lists/reads only its own buckets/objects; a per-tenant credential cannot
  reach another tenant's prefix.
- **Affected capability:** storage. **Depends on:** A2.

## A5 — Knative function routes are not tenant-scoped
- **change-id:** `fix-knative-function-tenant-scope` · **Labels:** `bug` `security` `tenant-isolation` `P1` `cap:functions` `openspec`
- **Problem:** Control-plane Knative function routes are `auth:'authenticated'` with no tenant scope;
  `getFnAction(pool, resourceId)` has no `tenant_id` predicate → any authenticated principal can
  invoke/read any tenant's function (incl. inline source + activation logs) by `resourceId`.
- **Evidence:** route authz + unscoped query (`evidence/06-functions-events.md`).
- **Proposed solution:** add a `tenant_id` predicate to function lookups and an ownership check on
  invoke/get/activations.
- **Acceptance:** cross-tenant function access by resourceId → 404/403.
- **Affected capability:** functions.

## A6 — Auth-as-a-service end users land in the shared platform realm
- **change-id:** `fix-end-user-tenant-realm-placement` · **Labels:** `bug` `security` `tenant-isolation` `P1` `cap:auth` `openspec`
- **Problem:** `POST /v1/auth/signups {tenantId}` creates the user in `in-falcone-platform`
  (alongside `superadmin`), not in the tenant's realm; the user gets no `tenant_id` attribute. Note:
  the **admin** path `POST /v1/tenants/{t}/users` (`createTenantUser`) correctly creates users in the
  tenant's `iam_realm` — so this is specifically the **self-service signup** path placing app end-users
  in the shared platform realm.
- **Evidence:** `evidence/09-auth-and-governance.md` (enduser1 appeared in platform realm; tenant realm
  stayed empty); contrast `b-handlers.mjs::createTenantUser`.
- **Proposed solution:** route self-service signup to the tenant's `iam_realm` (as `createTenantUser`
  does); stamp `tenant_id`/`workspace_id` attributes (the `tenant-context` scope already maps them).
- **Acceptance:** a signup for tenant T creates the user only in T's realm with tenant claims; platform
  realm holds only platform principals.
- **Affected capability:** auth / identity.

---

# EPIC B — Core data-plane & auth flows are broken end-to-end (HIGH)
**Labels:** `epic` `bug` `P1` `cap:data-plane`
**Problem:** Even ignoring isolation, several primary capabilities don't complete a basic flow.

## B1 — Postgres DDL→data round-trip: API-created tables are unusable
- **change-id:** `fix-postgres-ddl-grants-and-rls` · **Labels:** `bug` `P1` `cap:database` `openspec`
- **Problem:** DDL `create table` emits only `CREATE TABLE …` — no GRANT to the api-key DB roles
  (`falcone_service`/`falcone_anon`) and no RLS. The data API (runs as the api-key role) then returns
  `TABLE_NOT_FOUND` for tables it just created.
- **Evidence/repro:** `specs/03-postgres-isolation.sh` step "PG-2" — create table via API → insert via
  service key → **404 TABLE_NOT_FOUND**.
- **Proposed solution:** the DDL/provisioning path must grant the api-key roles + install the
  tenant RLS policy (ties into A3). **Acceptance:** create-table-then-CRUD works via the API for the
  issuing tenant only.

## B2 — Document by-id CRUD silently no-ops (ObjectId vs string)
- **change-id:** `fix-mongo-document-id-objectid-coercion` · **Labels:** `bug` `P1` `cap:document-db` `openspec`
- **Problem:** `_id` is stored as a BSON `ObjectId` but by-id handlers query `{_id: "<hex>"}` → never
  match. get/update/replace/delete by id all no-op; DELETE returns `200 {deleted:0}` (silent data
  non-deletion).
- **Evidence/repro:** `specs/04-document-mongo.sh` — insert doc, `GET …/documents/{insertedId}` →
  `{found:false}`. **Proposed solution:** coerce `_id` to `ObjectId` (with string fallback) in the
  mongo executor. **Acceptance:** by-id round-trip on the returned id works; DELETE of a real id → removed.

## B3 — Auth-as-a-service login fails after signup ("Account is not fully set up")
- **change-id:** `fix-auth-as-a-service-login` · **Labels:** `bug` `P1` `cap:auth` `openspec`
- **Problem:** After `POST /v1/auth/signups` → 201, `POST /v1/auth/login-sessions` and direct Keycloak
  ROPC both fail `invalid_grant "Account is not fully set up"`, although the user is
  `enabled/emailVerified/requiredActions:[]` and has a password credential. **Confirmed broader:** the
  same failure occurs for a user created directly via the Keycloak admin API in `in-falcone-platform`
  — so **no newly-created platform user can authenticate via ROPC** (only the bootstrap `superadmin`
  works). The realm has **no default required actions** (`defaultAction=false` for all), so the cause
  is the realm/client direct-grant flow or `in-falcone-console` consent config.
- **Evidence:** `evidence/09-auth-and-governance.md` + D6 probe. **Impact:** broadened — blocks
  onboarding of *any* new platform/tenant principal, not just self-service signup. **Proposed
  solution:** fix the `in-falcone-console` direct-grant flow/consent so a fully-set-up user
  authenticates. **Acceptance:** a freshly created platform user (and a signup) can log in → token →
  authorized call.

## B4 — Quota/usage consumption is never measured
- **change-id:** `fix-quota-consumption-measurement` · **Labels:** `bug` `P2` `cap:quotas` `openspec`
- **Problem:** `GET /v1/tenants/{t}/plan/consumption` and `/v1/metrics/.../usage` return every dimension
  `currentUsage:null`/`measuredValue:0` with `NO_QUERY_MAPPING` / `CONSUMPTION_QUERY_FAILED`. Usage-based
  quota enforcement can't fire.
- **Evidence:** `evidence/09-…`, `evidence/13-metrics.md`. **Proposed solution:** implement the missing
  consumption query mappings (likely tied to the shared-DB wiring in A3). **Acceptance:** consumption
  reflects real resource counts; soft/hard limits enforce.

## B5 — Realtime: Mongo collection DELETE events are never delivered
- **change-id:** `fix-mongo-realtime-delete-preimage` · **Labels:** `bug` `P2` `cap:realtime` `openspec`
- **Problem:** On the Mongo change-stream SSE path, `delete` events never reach subscribers even with
  `changeStreamPreAndPostImages` enabled — `fullDocumentBeforeChange` isn't populated, so the
  executor's `$match` delete branch drops the event. (Postgres realtime delivers deletes correctly.)
- **Evidence/repro:** `specs/08-realtime.sh` — subscribe to a collection, delete a doc via the driver →
  no `delete` frame; insert/update frames arrive. **Impact:** subscribers keep stale data after a
  delete (no isolation impact — dropped, never leaked). **Proposed solution:** drive deletes off the
  change-stream `documentKey`+stored `tenantId` (or a pre-image lookup) instead of
  `fullDocumentBeforeChange`. **Acceptance:** a tenant's subscriber receives its own `delete` events;
  cross-tenant deletes still not delivered.

---

# EPIC C — Observability & REST surface completeness (MED)
**Labels:** `epic` `enhancement` `P2` `cap:observability`

## C1 — Falcone application/tenant metrics don't flow; no Falcone dashboards
- **change-id:** `add-falcone-metrics-scrape-and-dashboards` · **Labels:** `bug` `P2` `cap:observability` `openspec`
- **Problem:** the in-chart Falcone Prometheus scrapes only itself (1 target, 0 falcone metrics); no
  ServiceMonitor for control-plane/executor; Grafana has 0 Falcone dashboards; metrics API returns zeros.
- **Evidence:** `evidence/13-metrics.md`. **Proposed solution:** add ServiceMonitors + expose
  `/metrics` on the services; ship Falcone dashboards; back the metrics API with real series.
  **Acceptance:** Prometheus scrapes falcone targets; a Falcone tenant dashboard shows non-zero data.

## C2 — Advertised-but-unwired REST routes (completeness/parity)
- **change-id:** `add-wire-advertised-public-routes` · **Labels:** `enhancement` `P2` `cap:api` `openspec`
- **Problem:** the live runtime implements a fraction of the 392-route OpenAPI catalog; `NO_ROUTE` for
  storage object I/O, function secrets/triggers/rules, tenant memberships/invitations/custom-roles,
  tenant dashboard, mongo aggregation/admin, several metrics dashboards. This is a REST↔spec and
  REST↔console completeness gap.
- **Evidence:** route probes across `evidence/05/06/09/10/13`. **Proposed solution:** either wire the
  intended handlers or trim the published surface so the catalog matches reality.
  **Acceptance:** every advertised route either responds or is removed from the public catalog.

---

# EPIC D — Tenant lifecycle & web console (MED/HIGH)
**Labels:** `epic` `P1` `cap:provisioning` `cap:web-console`

## D1 — No tenant deletion / purge / cascading cleanup (offboarding gap)
- **change-id:** `add-tenant-delete-purge-cascade` · **Labels:** `bug` `tenant-isolation` `P1` `cap:provisioning` `openspec`
- **Problem:** `DELETE /v1/tenants/{t}`, `POST /v1/tenants/{t}/purge` (and deactivate/suspend/archive)
  → **404 NO_ROUTE**. There is no way to offboard a tenant or clean up its resources; tenants,
  workspaces, registry rows, async-op rows and any provisioned Postgres/realm/bucket/topic resources
  accumulate as **orphans** (audit priority #5 — "deletion with cascading cleanup, no orphaned
  cross-tenant data" — fails).
- **Evidence:** `evidence/11-provisioning-lifecycle.md`; an orphaned `workspace_databases` row
  (`wsdb_laprov909_prod`) with no backing DB; probe tenants had to be removed by direct SQL.
- **Proposed solution:** wire tenant delete/purge with a cascading saga (workspaces, DBs, realms,
  buckets, topics, keys, registry rows). **Acceptance:** purging a tenant removes every owned resource;
  no orphaned rows/DBs/realms/buckets remain.

## D2 — Workspace physical database is never provisioned
- **change-id:** `fix-workspace-db-provisioning-saga` · **Labels:** `bug` `P1` `cap:provisioning` `openspec`
- **Problem:** `POST /v1/workspaces` creates a `workspace_databases` registry row but the backing
  `wsdb_*` Postgres database is never created (only the two long-lived demo workspaces have real DBs).
  Ties into A3/B1 (runtime ignores per-workspace DBs anyway).
- **Evidence:** `evidence/11-…`. **Acceptance:** a new workspace gets a real, isolated database the
  data API actually connects to.

## D3 — Multiple isolated environments per project not supported
- **change-id:** `add-environment-first-class-isolation` · **Labels:** `enhancement` `P2` `cap:provisioning` `openspec`
- **Problem:** "environment" (prod/staging/dev) is only a workspace slug; no environment entity and no
  isolated per-environment resource set (the requirement asks for prod/staging/dev with isolated
  resources). **Acceptance:** a project can hold multiple environments each with isolated DB/bucket/
  topics/secrets.

## D4 — Console "new tenant" wizard targets a non-existent route
- **change-id:** `fix-console-tenant-create-path` · **Labels:** `bug` `P2` `cap:web-console` `openspec`
- **Problem:** the console POSTs to `/v1/admin/tenants` (404; not in the catalog); only `/v1/tenants`
  exists. UI-driven tenant creation fails. **Evidence:** `evidence/12-console-parity.md` (CONS-1).
  **Acceptance:** creating a tenant from the console succeeds.

## D5 — Console not edge-routable as deployed
- **change-id:** `fix-console-edge-routing` · **Labels:** `bug` `P2` `cap:web-console` `openspec`
- **Problem:** no ingress controller is deployed, so the SPA's same-origin `/v1/*` calls have no edge
  to reach the control-plane; a real browser on the console host gets HTML for every API call.
  **Evidence:** CONS-3. **Acceptance:** the console reaches the API end-to-end in the deployed topology.

## D6 — RESOLVED (not filed): management-plane tenant scoping is correct
- **Verified clean (code-confirmed):** `routes.mjs` makes `GET /v1/tenants` **superadmin-only**
  (`auth:'superadmin'`) — a non-superadmin can't fetch the list at all; `getTenant`
  (`/v1/tenants/{id}`, `auth:'authenticated'`) enforces
  `identity.tenantId === t.id` → **403 "cannot read another tenant"**; `canManageTenant` gates
  user-management to the owning tenant. So the console's client-side filter (CONS-4) is moot. **No
  management-plane cross-tenant leak — do NOT file.** (Could not runtime-exercise from a tenant
  principal only because tenant logins are blocked by B3; the code path is correct.)

---

# Not filed as bugs (NOT-DEPLOYED / in-flight)
Temporal/Flows (workflows), MCP server hosting (modules not wired), FerretDB-wired document path
(wiring gap), OpenBao secrets, storage object I/O, Kafka→function/workflow triggers, team-management
API. Tracked as deployment/enablement work, not defects (see `evidence/14-inflight-features.md`).

---

_Pending additions from the still-running agents: Realtime/CDC, Provisioning lifecycle
(orphaned-resource cleanup), Web console / API↔console parity._
