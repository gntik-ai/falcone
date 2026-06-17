# Proposed OpenSpec epics & GitHub issues — DRY RUN (live E2E campaign 2026-06-17)

> Status: **DRY RUN** — nothing created yet. On confirmation: scaffold each as an OpenSpec change (`/opsx:propose <change-id>`) on the feature branch and file the GitHub issues with the labels below. `fix-…` = bug, `add-…` = enhancement.
> Repo labels reused: `bug` / `enhancement`, `P0|P1|P2`, `security`, `tenant-isolation`, `cap:<name>`, `openspec`, `e2e`.

---

## EPIC A — Cross-tenant isolation breach in the data-plane (P0)  · labels: `bug` `security` `tenant-isolation` `P0` `openspec`

### A.1 — `fix-executor-apikey-cross-tenant-idor`  · `P0` `security` `tenant-isolation` `cap:external-apps-service-accounts`
**Problem.** `POST /v1/workspaces/{workspaceId}/api-keys` (served by the cp-executor) does not verify that `{workspaceId}` belongs to the caller's tenant. A tenant owner of tenant A can mint an API key in tenant B's workspace; that key then grants access to tenant B's data-plane.
**Reproduction / evidence.**
1. `acme-ops` (JWT `tenant_id=<acme>`) → `POST /v1/workspaces/<globex-ws>/api-keys` → **201** (`flc_anon_…`).
2. acme-minted key → `GET /v1/postgres/workspaces/<globex-ws>/data/postgres/schemas/public/tables/x/rows` → **404 TABLE_NOT_FOUND** (authorized into globex's DB, not denied).
3. Control: acme's *own* key → globex workspace → **403** (correctly denied).
**Proposed solution.** In the executor api-key issuance path, resolve the owning tenant of `{workspaceId}` and reject (403 `CROSS_TENANT_VIOLATION`) when it differs from the verified caller `tenant_id`; add the same guard to any other admin route that takes a `{workspaceId}` path param without re-deriving the tenant from the resource.
**Acceptance criteria.** Issuing a key in a foreign-tenant workspace → 403; a black-box test mints in own ws (201) and foreign ws (403); cross-tenant probe added to the E2E isolation fixtures.
**Affected capability:** cap-external-apps-service-accounts / cap-tenant-isolation. **Severity:** P0. **Dependencies:** none.

---

## EPIC B — Document store (FerretDB/DocumentDB) data API broken  · labels: `bug` `P1` `openspec`

### B.1 — `fix-ferretdb-gateway-authentication`  · `P1` `cap:mongo-data-api`
**Problem.** Neither the control-plane nor a direct Mongo client can authenticate to the FerretDB gateway, so all `/v1/mongo/*` browse + data operations 500 and document-DB provisioning 400s.
**Evidence.** `GET /v1/mongo/databases`→500; insert/list documents→500 `CONTROL_PLANE_ERROR`; control-plane log `MongoServerError … HandshakeError`; direct driver with documentdb creds → `Authentication failed`. control-plane uses `MONGO_USER=falcone` + the documentdb password.
**Proposed solution.** Reconcile the FerretDB auth model with the consumer credentials: either configure the FerretDB gateway to accept the `falcone` principal mapped to the documentdb role, or repoint `MONGO_USER`/`MONGO_PASSWORD` (and the ferretdb `postgresql-url`) to a coherent identity; add a startup readiness probe that fails closed on auth error.
**Acceptance.** `GET /v1/mongo/databases`→200; insert+list document round-trips; `POST …/databases {engine:mongodb}`→2xx; real-stack test in `tests/env`. **Affected:** cap-mongo-data-api, cap-mongo-cdc, cap-realtime (Mongo SSE). **Severity:** P1.

### B.2 — `fix-mongo-database-provision-400` *(folded into B.1 if same root cause; otherwise standalone)* · `P2` `cap:mongo-data-api`

---

## EPIC C — Chart/runtime cannot install unattended on kind from current source  · labels: `bug` `P1` `openspec`

### C.1 — `fix-ferretdb-init-documentdb-host`  · `P1` `cap:mongo-data-api`
**Problem.** ferretdb init container hardcodes `PGHOST=in-falcone-documentdb` (chart-name prefix); for any release not named `in-falcone` (e.g. `falcone`) the service is release-prefixed → pod stuck `Init:0/1`.
**Evidence.** `charts/in-falcone/values.yaml:2129`; pod log `in-falcone-documentdb:5432 - no response`. **Fix.** Template the host from the release/component service name. **Accept.** Fresh install with an arbitrary release name → ferretdb Ready.

### C.2 — `fix-bootstrap-job-standalone-apisix`  · `P1` `cap:tenant-provisioning`
**Problem.** The Keycloak bootstrap Job fails on a fresh install — its APISIX-standalone reconciliation phase fails even with the noop-route workaround — so the platform realm/clients/superadmin are never provisioned. (The realm payload itself is valid: manual `POST /admin/realms`→201.)
**Fix.** Make the reconcile phase a no-op (or skip it) under `APISIX_STAND_ALONE`; gate the route loop correctly so zero admin-API calls are emitted. **Accept.** Fresh install → bootstrap Job `Complete`, realm + console/gateway clients + superadmin present, superadmin can log in.

### C.3 — `fix-apisix-gateway-shared-secret-provisioning`  · `P1` `cap:gateway`
**Problem.** APISIX standalone config references `${{GATEWAY_SHARED_SECRET}}` but the chart never sets it → CrashLoop `can't find environment variable GATEWAY_SHARED_SECRET`. **Fix.** Provision an `in-falcone-gateway-shared-secret` and map `apisix.env GATEWAY_SHARED_SECRET` (and the matching executor env) by default. **Accept.** Fresh install → APISIX Ready; executor enforces gateway-trust.

### C.4 — `fix-helm-wait-documentdb-hook-ordering`  · `P2` `cap:tenant-provisioning`
**Problem.** `helm install --wait` deadlocks: ferretdb (main resource) waits on the `documentdb_api` schema created by a *post-install hook*. **Fix.** Make documentdb extension creation a pre-requisite the gateway can wait on without `--wait` deadlock (init-container against the engine, or a non-hook Job with proper ordering). **Accept.** `helm install --wait` converges.

### C.5 — `fix-control-plane-schema-migration-retry`  · `P1` `cap:tenant-lifecycle`
**Problem.** control-plane runs migrations once on boot and never retries on `ECONNREFUSED`; if Postgres isn't ready the `tenants` table is missing and every tenant op 500s. **Evidence.** log `schema/recovery failed: connect ECONNREFUSED`; `relation "tenants" does not exist`; fixed by restart. **Fix.** Retry-with-backoff the boot migration until the DB is reachable. **Accept.** control-plane started before Postgres still converges to `schema ready`.

### C.6 — `fix-vault-secrets-backend-on-kind` *(or `add-…`)* · `P2` `cap:secrets`
**Problem.** Enabling Vault aborts the release (its TLS cert needs cert-manager, absent on kind) and **no component reads from Vault** (ESO disabled). "Secrets via Vault" is not wired. **Fix.** Either ship cert-manager + ESO wiring (so secrets actually resolve from Vault) or make Vault opt-in with a documented prerequisite and a self-signed TLS path on kind. **Accept.** With Vault enabled, at least one app secret resolves *from Vault*, and the release installs cleanly.

### C.7 — `fix-stale-migration-components-in-running-release` · `P2` `tenant-isolation` `cap:tenant-provisioning`
**Problem (deployment hygiene).** The *running* (pre-campaign) release still ran MongoDB + a MinIO-named NodePort + an OpenWhisk svc-stub, with control-plane/executor pointed at **MongoDB not FerretDB** — an incomplete migration in the live environment. **Fix.** Re-deploy from current chart (drops them) and add a CI/deploy guard that fails if legacy components render. **Accept.** No `mongodb`/`minio`/`openwhisk` workloads in the deployed release; control-plane env points at FerretDB/SeaweedFS.

---

## EPIC D — Realm-per-tenant auth is unusable as shipped  · labels: `bug` `security` `P1` `openspec`

### D.1 — `fix-platform-client-default-scopes`  · `P1` `security` `cap:auth-console`
**Problem.** `in-falcone-console`/`in-falcone-gateway` clients are created without the standard `roles`/`basic`/`profile` default client scopes → issued tokens carry no `realm_access.roles` → every role-gated op 403s (superadmin included). **Evidence.** token scope `openid` only; adding `roles` → `superadmin` appears → 403→201. **Fix.** Include the standard default scopes (alongside the custom context scopes) in the client payloads. **Accept.** Fresh-bootstrapped superadmin token contains `realm_access.roles` and can create a tenant.

### D.2 — `fix-tenant-realm-token-issuance`  · `P1` `security` `cap:iam-admin`
**Problem.** createTenant/createTenantUser place tenant users in the tenant realm, but (a) the tenant realm gets no client and no `tenant_id` mapper, and (b) the executor verifies JWTs only against the **platform realm JWKS** → tenant-realm tokens are rejected `Missing tenant identity`. Net: tenant owners/users cannot reach the data-plane or console via the documented flows. **Fix.** Provision a per-tenant app client + `tenant_id` mapper at tenant creation (the "auth templates preloaded into the project" step), and make the executor accept tenant-realm issuers (multi-realm JWKS) or define the intended token path. **Accept.** A tenant owner obtains a token that the executor accepts and can issue a key / read their own data; foreign-tenant denied.

### D.3 — `fix-platform-user-profile-unmanaged-attributes`  · `P2` `cap:iam-admin`
**Problem.** Platform realm's declarative user profile drops the `tenant_id` attribute → platform users can't carry tenant scope. **Fix.** Add `tenant_id`/`workspace_id` to the user profile (or set `unmanagedAttributePolicy`). **Accept.** Setting `tenant_id` on a platform user surfaces it in the token.

### D.4 — `fix-superadmin-created-disabled`  · `P2` `cap:auth-console`
**Problem.** The bootstrap superadmin user is created disabled → cannot log in. **Fix.** Create it `enabled:true, emailVerified:true, requiredActions:[]`. **Accept.** Fresh-bootstrapped superadmin logs in without manual edits.

---

## EPIC E — Console-facing 500s  · labels: `bug` `P2` `openspec`

### E.1 — `fix-plans-list-500` · `P2` `cap:quotas-plans` — `GET /v1/plans` (superadmin) → 500 (provisioning-orchestrator `plan-list`). Accept: 200 with the plan catalog.
### E.2 — `fix-metrics-quotas-500` · `P2` `cap:metrics` — `GET /v1/metrics/tenants/{id}/quotas` → 500 (`metrics-handlers.mjs:49 tenantLimits` `Forbidden` + `42P01`). Accept: 200 with quota view; missing relation created/migrated.

---

## Enhancements (separate from bugs)  · labels: `enhancement` `openspec`

- `add-live-e2e-console-playwright` (`cap:web-console`) — drive every console admin action + API↔console parity, now that the platform installs.
- `add-kind-profile-advanced-capabilities` (`cap:functions`/`cap:realtime`) — make realtime (Mongo SSE), Temporal workflows, and MCP hosting installable/testable in the kind profile (env flags + components) so the expected-but-absent capabilities can be exercised.

---

### Suggested epic→issue grouping for GitHub
- **Epic A** (P0 isolation) → A.1
- **Epic B** (FerretDB data API) → B.1 (+B.2)
- **Epic C** (install hardening) → C.1–C.7
- **Epic D** (auth model) → D.1–D.4
- **Epic E** (console 500s) → E.1–E.2
- Enhancements → 2 issues
</content>
