# Evidence: C6–C12 Auth / IAM / App-Auth / API Keys
**Campaign:** 2026-06-18 live run (fresh HEAD install, kind cluster test-cluster-b, ns `falcone`)
**Tester:** sub-agent, empirical only — all status codes are actual HTTP responses
**Environment note:** Keycloak pod (falcone-keycloak-65d655bd54-rb7f5) restarted at 16:15:11Z
(OOM, exit 137) after bootstrap completion at 15:50:51Z. KC is configured with **H2 in-memory
database** (no PVC, no external DB), so all realm data (platform realm, tenant realms) was
**lost on restart**. Tests marked [PRE-KC-RESET] were run before 16:15; tests marked
[POST-KC-RESET] after. JWT-bearing GW tests post-reset return 401 (INVALID_CREDENTIALS /
"Realm does not exist").

---

## C6 — Console Auth: login-sessions + refresh + logout [PRE-KC-RESET]

All tests via GW (`http://localhost:9080`) using `superadmin` and `acme-ops`.

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C6-1 | POST /v1/auth/login-sessions (superadmin) | **Working** | 201 — tokenSet.accessToken + refreshToken present; top-level: sessionId, authenticationState, statusView, issuedAt, expiresAt, refreshExpiresAt, sessionPolicy, principal |
| C6-2 | POST /v1/auth/login-sessions (tenant_owner) | **Working** | 201 — same shape |
| C6-3 | idToken in tokenSet | **Missing** | idToken always null in tokenSet |
| C6-4 | POST /v1/auth/login-sessions/{id}/refresh | **Working** | 200 — new accessToken + refreshToken returned |
| C6-5 | DELETE /v1/auth/login-sessions/{id} (logout) | **Working** | 200 |
| C6-6 | PUT /v1/auth/login-sessions/{id} (refresh — alt path) | **Not deployed** | 404 NO_ROUTE — catalog has `refreshConsoleLoginSession` at POST .../refresh (correct path used for C6-4) |

**JWT claims — superadmin:** `preferred_username: superadmin`, `realm_access.roles: [superadmin, ...]`, `tenant_id: null` (superadmin has no tenant_id — correct). No `actorType` / `actor_type` claim.

**JWT claims — acme-ops (tenant_owner):** `preferred_username: acme-ops`, `realm_access.roles: [tenant_owner, ...]`, `tenant_id: 676c519b-0062-4af0-9845-cdeee26b82b8` — tenant-scoped, correct. No `actorType` claim.

**Post-KC-reset:** `POST /v1/auth/login-sessions` returns `401 INVALID_CREDENTIALS / "Realm does not exist"`.

---

## C7 — AuthZ roles: superadmin vs tenant_owner [PRE-KC-RESET]

All tests via GW with verified tokens.

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C7-1 | superadmin GET /v1/tenants (list all) | **Working** | 200 |
| C7-2 | tenant_owner GET /v1/tenants (list all) | **Working (deny)** | 403 `{"code":"FORBIDDEN","message":"requires superadmin"}` |
| C7-3 | tenant_owner GET /v1/tenants/{own_tenant} | **Working** | 200 |
| C7-4 | tenant_owner GET /v1/tenants/{own_tenant}/workspaces | **Working** | 200 |
| C7-5 | tenant_owner GET /v1/plans (superadmin-only) | **Working (deny)** | 403 |
| C7-6 | tenant_owner GET /v1/users (superadmin-only) | **Not deployed** | 404 |

**Isolation — cross-tenant tenant_owner access:**

| Probe | Result |
|-------|--------|
| acme-ops GET /v1/tenants/{globex_tenant} | 403 FORBIDDEN |
| globex-ops GET /v1/tenants/{acme_tenant} | 403 FORBIDDEN |

---

## C8 — IAM Admin: realms/users/roles/groups/clients/role-mappings [PRE-KC-RESET + supplementary]

GW JWT + KC admin API tested.

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C8-1 | GET /v1/iam/realms/{id}/users (list) | **Working** | 200 — returns `{items:[{id,userId,username,email,enabled,state,realmRoles,...}]}` |
| C8-2 | POST /v1/iam/realms/{id}/users (create) | **Working** | 201 — returns `{userId,username,realm,roles,createdBy}` |
| C8-3 | GET /v1/iam/realms/{id}/users/{id} (get single) | **Broken** | 404 NO_ROUTE — route `getIamUser` is in catalog but not wired in runtime |
| C8-4 | PATCH /v1/iam/realms/{id}/users/{id} (update) | **Not deployed** | 404 NO_ROUTE — route `updateIamUser` in catalog (PUT not PATCH); neither mapped |
| C8-5 | PATCH /v1/iam/realms/{id}/users/{id}/status (disable) | **Working** | 200 — `setIamUserStatus` route works |
| C8-6 | DELETE /v1/iam/realms/{id}/users/{id} | **Working** | 200 |
| C8-7 | GET /v1/iam/realms/{id}/roles (list) | **Working** | 200 — 14 roles returned |
| C8-8 | POST /v1/iam/realms/{id}/roles (create) | **Working** | 201 — `{name,realm}` |
| C8-9 | GET /v1/iam/realms/{id}/roles/{name} (get single) | **Broken** | 404 NO_ROUTE — in catalog (`getIamRole`) but not wired |
| C8-10 | DELETE /v1/iam/realms/{id}/roles/{name} | **Broken** | 404 NO_ROUTE — in catalog but not wired |
| C8-11 | GET /v1/iam/realms/{id}/clients (list) | **Working** | 200 — 7 clients including acme-app |
| C8-12 | GET /v1/iam/realms/{id}/groups (list) | **Working** | 200 |
| C8-13 | POST /v1/iam/realms/{id}/role-mappings | **Not deployed** | 404 NO_ROUTE — path not in catalog; correct endpoint is per user |
| C8-14 | GET /v1/iam/realms (list realms) | **Not deployed** | 404 NO_ROUTE — `listIamRealms` in catalog but not wired |
| C8-15 | GET /v1/iam/realms/{id} (get realm) | **Not deployed** | 404 NO_ROUTE — `getIamRealm` in catalog but not wired |
| C8-16 | PUT /v1/iam/realms/{id} (update realm) | **Not deployed** | 404 NO_ROUTE — `updateIamRealm` in catalog but not wired |

**Bug B8-A:** `getIamUser` (`GET /v1/iam/realms/{id}/users/{userId}`) returns 404 NO_ROUTE despite being in the public route catalog and the route being in the OpenAPI spec. The route handler is not registered.

**Bug B8-B:** `getIamRole` and `deleteIamRole` at `/v1/iam/realms/{id}/roles/{roleName}` return 404 NO_ROUTE despite being in catalog.

**Isolation — acme-ops (tenant_owner) accessing globex realm:**

| Probe | Result |
|-------|--------|
| acme-ops GET /v1/iam/realms/{globex}/users | 403 `{"code":"FORBIDDEN","message":"requires superadmin"}` |
| acme-ops POST /v1/iam/realms/{globex}/users | 403 |

---

## C9 — App auth-as-a-service: templates + per-project config [PRE-KC-RESET + supplementary]

Tested via KC admin API (direct) and Falcone API surface.

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C9-1 | Predefined KC clients in tenant realm | **Working** | acme realm has: `account`, `account-console`, `acme-app`, `admin-cli`, `broker`, `realm-management`, `security-admin-console` — tenant-scoped client (`acme-app`) provisioned |
| C9-2 | Authentication flows in tenant realm | **Working** | 7 built-in flows: browser, direct grant, registration, reset credentials, clients, first broker login, docker auth |
| C9-3 | loginWithEmailAllowed (username OR email) | **Working** | KC realm config shows `loginWithEmailAllowed: true`, `registrationEmailAsUsername: false` |
| C9-4 | registrationAllowed | **Partial** | `registrationAllowed: false` in realm config — self-registration disabled by default; no Falcone API to enable it |
| C9-5 | Social OAuth provider (Google IdP) via KC admin API | **Working** | POST `/admin/realms/{id}/identity-provider/instances` with `providerId: google`, placeholder creds → 201; IdP appears in list (2 entries confirmed); DELETE → 204 (cleanup) |
| C9-6 | Social OAuth via Falcone API | **Not deployed** | `GET /v1/iam/realms/{id}/auth-methods` → 404; `GET /v1/iam/realms/{id}/identity-providers` → 404. No Falcone API for IdP/social config — must use raw KC admin API |
| C9-7 | Per-project auth config isolation | **Working (KC level)** | Each tenant has its own KC realm; IdP config added to realm A does not affect realm B |
| C9-8 | Toggle auth method and confirm login options change | **Not testable** | KC is reset post-crash; cannot verify end-user login options after toggle |
| C9-9 | Falcone API for realm update (enable login settings) | **Not deployed** | `PUT /v1/iam/realms/{id}` → 404 NO_ROUTE |

**Auth-method config:** No Falcone-native API surface for IdP/social OAuth config. Management requires direct access to KC admin API.

---

## C10 — App end-user: register → login → token → authorized call [PRE-KC-RESET partially; POST-KC-RESET: NOT TESTABLE]

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C10-1 | App end-user provisioning (create via IAM admin) | **Working** (pre-reset) | `enduser@acme.test` exists in TA realm (visible in user list) |
| C10-2 | End-user ROPC login (`acme-app` client, TA realm) | **Not testable** (post-reset) | KC realm lost; `"Realm does not exist"` |
| C10-3 | End-user token tenant_id unforgeable | **Partial** | Token issuer is bound to the per-tenant KC realm; iss = `http://falcone-keycloak:8080/realms/{tenantId}`. Cross-realm login attempt: ROPC against TA realm with TB user → realm-specific error (conceptually isolated); cannot complete full test due to KC reset |
| C10-4 | Social-provider login | **Not testable** | No real IdP creds; redirect surface only. Social login requires real IdP client credentials |
| C10-5 | End-user makes authorized call | **Not testable** | Requires valid tenant realm JWT; KC reset |
| C10-6 | Self-registration API (`POST /v1/auth/signups`) | **Unknown** | Route `createConsoleSignup` exists in catalog but not tested (requires KC). This appears to be platform signup (ops users), not app end-users |

---

## C11 — Owner manages app end-users (list/view/disable/delete) [PRE-KC-RESET + code audit]

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C11-1 | Falcone API to list app end-users | **Partial** | Via `GET /v1/iam/realms/{tenantId}/users` (superadmin) — returns all realm users including end-users. No dedicated endpoint for tenant_owner-only end-user management |
| C11-2 | Falcone API to get single end-user | **Broken** | See B8-A: `GET /v1/iam/realms/{id}/users/{userId}` → 404 |
| C11-3 | Falcone API to disable end-user | **Working** | `PATCH /v1/iam/realms/{id}/users/{userId}/status` → 200 |
| C11-4 | Falcone API to delete end-user | **Working** | `DELETE /v1/iam/realms/{id}/users/{userId}` → 200 |
| C11-5 | Tenant_owner can list/manage own realm users | **Broken** | `GET /v1/iam/realms/{id}/users` requires superadmin (403 for tenant_owner). Tenant owners cannot use the IAM admin routes to manage their own end-users |
| C11-6 | Cross-tenant end-user management | **Working (deny)** | acme-ops → globex realm → 403 |

**Bug B11-A (P1):** `GET /v1/iam/realms/{id}/users` returns 403 for tenant_owner (`"requires superadmin"`). The route catalog specifies it as an IAM admin route, but the enforcement requires superadmin for all IAM user/role listing — tenant owners cannot self-serve manage their own realm. Tenant owners must escalate to superadmin for IAM operations.

---

## C12 — Service accounts + API keys (issue/rotate/revoke) [Working]

All tests via executor trust-header path + fixture keys. KC not required.

| fn-id | Functionality | Status | Evidence |
|-------|--------------|--------|----------|
| C12-1 | List API keys for workspace | **Working** | `GET /v1/workspaces/{ws}/api-keys` (trust-header) → 200; returns `{items:[{id,key_type,key_prefix,scopes,status,created_at,last_used_at}]}` |
| C12-2 | Issue API key (POST) | **Working** | 201 — returns `{id,key,prefix,keyType,scopes,createdAt}`; key is `flc_service_...` |
| C12-3 | Key format inconsistency (list vs mint) | **Bug (P2)** | Mint response uses camelCase (`keyType`,`createdAt`); list items use snake_case (`key_type`,`created_at`). Inconsistent schema |
| C12-4 | Rotate API key | **Working** | `POST /v1/workspaces/{ws}/api-keys/{id}/rotations` → 201 — new key issued |
| C12-5 | Old key invalidated after rotation | **Working** | Old key prefix `flc_service_x-Y4...` → 401 on workspace-scoped endpoint after rotation |
| C12-6 | Revoke API key | **Working** | `DELETE /v1/workspaces/{ws}/api-keys/{id}` → 200 `{id,revoked:true}` |
| C12-7 | Revoked key stops working | **Working** | `flc_service_pix4...` (revoked) → 401 on workspace-scoped endpoint |
| C12-8 | /healthz accepts any key (no-auth) | **Working** | /healthz returns 200 regardless of key validity — this is expected (noAuth route) |
| C12-9 | API key cannot manage API keys | **Working** | Data-plane API key calling `GET /v1/workspaces/{ws}/api-keys` → 403 `"API keys cannot manage API keys"` |

**C12 Isolation probes:**

| Probe | Result | Evidence |
|-------|--------|----------|
| acme tenant_id (trust-header) mint key in globex ws (P0 re-test #534/#517) | **403 DENIED** | `{"code":"CROSS_TENANT_VIOLATION","message":"Workspace does not belong to the caller's tenant"}` |
| acme fixture key → globex workspace key-list | **403 DENIED** | `{"code":"FORBIDDEN","message":"Credential workspace does not match the requested workspace"}` |
| acme fixture key → globex postgres DDL | **401 DENIED** | Workspace binding check |
| globex fixture key → acme workspace key-list | **403 DENIED** | |

---

## Infrastructure finding: Keycloak H2 in-memory DB (P0 / BUG-INFRA)

**Description:** Keycloak is deployed without a persistent database. Its `Deployment` has no PVC,
no external DB env, and uses embedded H2 in-memory storage. When the KC pod restarts (OOM killed
at 16:15:11Z, exit 137), ALL realm data is lost: platform realm, tenant realms, users, clients,
roles, credentials.

**Impact:** Every KC restart:
1. Destroys all tenant auth config (realms, users, IdPs, clients)
2. Makes login impossible until reprovisioning (`provision-platform-realm.sh` + `seed.mjs`)
3. Invalidates all issued JWTs (JWKS keys change on restart)
4. Breaks GW authentication entirely

**Evidence:**
- Pod restart: `terminatedAt: 2026-06-18T16:15:11Z, exitCode: 137 (OOMKilled)`
- Post-restart: `GET /admin/realms` → `["master"]` only
- Post-restart: `POST /v1/auth/login-sessions` → `401 INVALID_CREDENTIALS / "Realm does not exist"`
- Build: KC `Deployment` envFrom only `falcone-keycloak-config` (has only `publicPath`) + `in-falcone-identity-client` (only `KC_BOOTSTRAP_ADMIN_PASSWORD` + username)

**Root cause:** Chart does not configure `KC_DB*` / `QUARKUS_DATASOURCE_*` env vars to point KC
at the PostgreSQL instance (unlike the control-plane which has full PG config). Intentional for
dev/kind? If so, should be documented and constrained by resource limits.

---

## Summary: per-functionality status

| Capability | Functionality | Status |
|------------|--------------|--------|
| C6 | Login POST /v1/auth/login-sessions | Working (pre-KC-reset) |
| C6 | Session refresh POST .../{id}/refresh | Working |
| C6 | Session logout DELETE .../{id} | Working |
| C6 | tokenSet.idToken | Missing (always null) |
| C7 | Superadmin vs tenant_owner enforcement | Working |
| C7 | Cross-tenant tenant_owner deny | Working (isolation: PASS) |
| C8 | List IAM users | Working |
| C8 | Create IAM user | Working |
| C8 | Get IAM user by ID | Broken (NO_ROUTE) |
| C8 | Disable IAM user (status) | Working |
| C8 | Delete IAM user | Working |
| C8 | List IAM roles | Working |
| C8 | Create IAM role | Working |
| C8 | Get/Delete IAM role by name | Broken (NO_ROUTE) |
| C8 | List IAM clients | Working |
| C8 | List IAM groups | Working |
| C8 | Get/Update/List realms | Not deployed (NO_ROUTE) |
| C8 | Cross-realm isolation (tenant_owner) | Working (isolation: PASS) |
| C9 | Per-tenant KC realm + provisioned client | Working |
| C9 | Auth flows (built-in) | Working |
| C9 | loginWithEmailAllowed config | Working |
| C9 | Social OAuth IdP via KC admin API | Working |
| C9 | Social OAuth via Falcone API | Not deployed |
| C9 | Falcone API for realm update | Not deployed |
| C10 | End-user ROPC login + token | Not testable (KC reset + no live credentials) |
| C10 | End-user registration API | Not deployed (no dedicated app-user register route) |
| C10 | Social login | Not testable (requires real IdP) |
| C11 | List end-users (tenant_owner) | Broken (403 requires superadmin) |
| C11 | Disable end-user | Working (superadmin only) |
| C11 | Delete end-user | Working (superadmin only) |
| C11 | Cross-tenant end-user management | Working (isolation: PASS) |
| C12 | Issue API key | Working |
| C12 | List API keys | Working |
| C12 | Rotate API key | Working |
| C12 | Revoke API key | Working |
| C12 | Revoked/rotated key stops working | Working |
| C12 | Cross-tenant key issuance (P0 re-test) | PASS (403 CROSS_TENANT_VIOLATION) |
| C12 | Cross-workspace key binding | PASS (403 / 401 on all probes) |

---

## Bugs

| ID | Sev | Capability | Description | Repro |
|----|-----|------------|-------------|-------|
| B-INFRA-KC | P0 | Platform | Keycloak uses H2 in-memory DB; all realm data lost on pod restart (OOMKilled 2026-06-18 16:15Z); login breaks entirely | KC pod restart; `GET /admin/realms` → only `master` |
| B8-A | P1 | C8 IAM | `GET /v1/iam/realms/{id}/users/{userId}` → 404 NO_ROUTE; route `getIamUser` in catalog but not wired | `curl GET /v1/iam/realms/{realmId}/users/{userId} -H "Authorization: Bearer $STOK_SA"` → 404 |
| B8-B | P2 | C8 IAM | `GET /v1/iam/realms/{id}/roles/{roleName}` and `DELETE` → 404 NO_ROUTE; `getIamRole`/`deleteIamRole` in catalog but not wired | `curl GET .../roles/lc8role777` → 404 |
| B11-A | P1 | C11 IAM | `GET /v1/iam/realms/{id}/users` returns 403 for tenant_owner; tenant owners cannot self-serve manage their own end-users | Login as acme-ops; `GET /v1/iam/realms/{tenantId}/users` → 403 "requires superadmin" |
| B12-A | P2 | C12 Keys | `listApiKeys` response uses snake_case (`key_type`,`created_at`) while `issueApiKey` response uses camelCase (`keyType`,`createdAt`). Inconsistent schema | Compare mint 201 body vs list 200 body fields |
| B-IAM-REALM | P2 | C8/C9 | Realm CRUD routes (`listIamRealms`, `getIamRealm`, `updateIamRealm`) are in catalog but return 404 NO_ROUTE in deployed runtime | `curl GET /v1/iam/realms` → 404 |

## Not deployed (by design or incomplete)
- Falcone-native IdP config API (`/v1/iam/realms/{id}/auth-methods`, `/v1/iam/realms/{id}/identity-providers`) — social OAuth config requires raw KC admin API
- App end-user registration API — no dedicated `/v1/auth/app-registrations` or similar; only KC realm direct
- Realm CRUD API (`listIamRealms`, `getIamRealm`, `updateIamRealm`) — in catalog, not deployed

## Could not test + why
- **C10 end-user login/token/authorized-call:** KC OOM restart wiped tenant realms; ROPC against per-tenant realm impossible. Would require KC reprovision + re-seed.
- **C10 social provider login:** No real IdP client credentials; redirect/config surface only verified.
- **C9 auth-method toggle → login options change:** Needs a live tenant realm with enabled IdP; KC reset prevented verification.

## Isolation verdict

| Boundary | Verdict | Evidence |
|----------|---------|----------|
| tenant_owner A cannot list all tenants | PASS | 403 FORBIDDEN "requires superadmin" |
| tenant_owner A cannot access tenant B | PASS | 403 |
| tenant_owner A cannot access B's IAM realm | PASS | 403 "requires superadmin" |
| API key A cannot mint key in B workspace (P0 re-test) | PASS | 403 CROSS_TENANT_VIOLATION |
| API key A cannot access B workspace data | PASS | 403 "Credential workspace does not match" |
| API key cross-workspace postgres | PASS | 401 workspace binding check |
| App end-user of A cannot reach B resources | Not testable | KC reset; JWT issuance broken |
