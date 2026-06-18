# 25 — Auth-as-a-Service (per-project Keycloak) + app end-user lifecycle + auth isolation

Live empirical test against the running `falcone` kind deployment (2026-06-18). All app end-user
auth resolves to per-tenant Keycloak realms (realm name == tenant UUID). KC at
`http://localhost:8080`; admin creds via `ksecret in-falcone-keycloak-admin`. Tokens/passwords
redacted throughout.

Fixtures: A=acme `$TA_TENANT=78848e21-…777e7e`, B=globex `$TB_TENANT=fe63fa39-…a338cc`.

## Status summary (per functionality)

| # | Functionality | Status |
|---|---|---|
| 1 | Per-tenant realms exist + OIDC discovery works | **Active/Working** |
| 2 | Predefined auth-method templates (model) | **Partial** — code-defined template; chart `tenantRealmTemplate.requiredClientScopes` NOT applied to tenant realms |
| 3 | Username/password login (username OR email) | **Active/Working** |
| 4 | App end-user register → login → token → authorized call | **Active/Working** (for tenants created by current image); **Broken** for pre-fix fixture realms (A3) |
| 5 | Social OAuth provider enable/reflect/disable | **Active/Working** |
| 6 | Owner manages app end-users (list/view/disable/delete) | **Partial** — KC layer works; Falcone owner API exposes only create+list; disable/delete routes are catalog-only (NO_ROUTE) |
| ISO | Cross-tenant realm/user/token isolation | **PASS — deny by default** |

---

## 1. Per-tenant realms + OIDC discovery — Active/Working

```
GET $KC/realms/$TA_TENANT/.well-known/openid-configuration  -> 200
GET $KC/realms/$TB_TENANT/.well-known/openid-configuration  -> 200
GET admin/realms -> [master, in-falcone-platform, 78848e21-…777e7e (acme), fe63fa39-…a338cc (globex)]
```
Exactly one realm per tenant, named by tenant UUID. TA realm settings:
`loginWithEmailAllowed=true, registrationAllowed=false, resetPasswordAllowed=true,
verifyEmail=false, duplicateEmailsAllowed=false`. Both fixture realms hold the 4 seeded users
(alice/bob/enduser/owner@{slug}.test), 0 identity providers, 6 (default KC) clients.

## 2. Predefined auth-method templates — Partial (templates-model finding)

**Model:** There is NO first-class "auth-method-template" object in Keycloak (no shared
client-scope library, no realm partial-import). The template is **two-layered**:

- **Declarative (chart):** `charts/in-falcone/values.yaml :: bootstrap.oneShot.keycloak.tenantRealmTemplate`
  defines `realmIdPattern: tenant-{tenantSlug}`, `requiredRealmRoles` (11 roles),
  `requiredClientScopes: [tenant-context, workspace-context, plan-context, workspace-roles]`,
  a `workspaceClientTemplate`, and a `serviceAccountTemplate`. Rendered into
  `bootstrap-payload-configmap.yaml`.
- **Runtime (actual):** the live control-plane provisions tenant realms in
  `deploy/kind/control-plane/kc-admin.mjs::createRealm` + `b-handlers.mjs::createTenant`. It
  applies a **hardcoded subset**: 11 realm roles (`kc-admin.mjs::TENANT_REALM_ROLES`), the login
  flags above, a public app client (`{slug}-app`) with a hardcoded `tenant_id` claim mapper, and
  `relaxUserProfile()` to make email/firstName/lastName optional (KC26 #496 fix).

**Preloading:** The chart **bootstrap job creates only the platform realm**
(`in-falcone-platform`); tenant realms are created at runtime per `POST /v1/tenants`. Empirically:

```
client-scopes(platform realm)   = [..., plan-context, tenant-context, workspace-context, workspace-roles, ...]   (custom scopes present)
client-scopes(fresh tenant realm) = [acr,address,basic,email,…,profile,roles,…]   (stock KC ONLY — custom scopes ABSENT)
```
So `requiredClientScopes` from the declarative template are **NOT preloaded into tenant realms**.
The runtime relies on the hardcoded `tenant_id` mapper instead. Divergence between chart template
and runtime provisioning — see BUG-AUTH-2. Social providers are NOT preloaded (each project
enables them itself, §5).

## 3. Username/password login (username OR email) — Active/Working

Tested on a freshly-created tenant realm (current image). A user with `username != email`:
```
ROPC client_id={slug}-app, username=<username>  -> OK token
ROPC client_id={slug}-app, username=<email>     -> OK token
```
Both succeed (`loginWithEmailAllowed=true` set by `createRealm`). No project-side toggle needed —
password login is on by default in every tenant realm.

## 4. App end-user register → login → token → authorized call

**As-shipped for NEW tenants (current image): Active/Working.** Full lifecycle on a throwaway
tenant `lcauth29833` (realm `d2d9350d-…bacc33`):

1. `createTenant` provisioned `lcauth29833-app` (public, directAccessGrantsEnabled=true) with a
   `tenant_id` hardcoded-claim mapper (value == realm id). **Confirms the A3 fix is deployed.**
2. Register end-user: `POST /v1/iam/realms/{realm}/users` (superadmin) -> **201**, user enabled,
   emailVerified, requiredActions=[].
3. OIDC login (ROPC against the tenant realm, client `{slug}-app`) -> **token issued**, claims:
   `iss=http://…/realms/d2d9350d-…bacc33`, `azp=lcauth29833-app`,
   `tenant_id=d2d9350d-…bacc33` (from the hardcoded mapper, un-forgeable).
4. Authorized call against a project resource (executor data-plane):
   ```
   GET $EXEC/v1/postgres/workspaces/{ws}/data/{wsdb}/schemas/public/tables/lcprofiles2/rows
       Authorization: Bearer <enduser JWT>
   -> 200 {"items":[{…,"tenant_id":"d2d9350d-…bacc33"}],"access":{"reason":"grant_and_rls_filter","rlsEnforced":true}}
   ```
   The executor verifies the tenant-realm JWT (`jwt-verify.mjs` trusts any realm under the same KC
   base; `tenant_id` derived from the verified issuer), routes to the per-workspace DB, and RLS
   enforces tenant scoping. End-to-end success.

**A3 workaround status for the PRE-FIX FIXTURE realms (acme/globex): Broken as-shipped.** These
realms were seeded by an earlier image and have **NO `{slug}-app` client** (only the 6 default KC
clients). Consequently:
```
ROPC client_id=acme-app  enduser@acme.test  -> invalid_client (client does not exist)
ROPC client_id=admin-cli enduser@acme.test  -> invalid_grant "Invalid user credentials" (admin-cli restricts ROPC to admins)
```
An app end-user in a pre-fix realm cannot obtain a usable token through any path. The
workaround `tests/live-campaign/provision-tenant-auth.sh` exists precisely for this (it creates an
`app-client` + `tenant_id` mapper post-hoc) but had NOT been run against these live realms. The
underlying code fix IS present; only the already-provisioned fixture realms are stranded.

## 5. Social OAuth provider — Active/Working

On the throwaway tenant realm:
```
POST identity-provider/instances {alias:google, providerId:google, enabled:true, config:{clientId:PLACEHOLDER…, clientSecret:PLACEHOLDER…}} -> 201
login page (auth endpoint, client={slug}-app):  contains href="/realms/{realm}/broker/google/login…"  (2 hits)  -> option RENDERED
PUT  …/instances/google {enabled:false}  -> 204
login page after disable:  0 broker/google hits  -> option REMOVED
DELETE …/instances/google -> 204
```
Config surface + available-login-options reflection work and are per-realm. (No real external
OAuth round-trip — placeholder creds, non-secret.) Note: there is **no Falcone control-plane route
for managing identity providers** — only the KC admin API; a project owner has no first-class
Falcone API to enable social login (gap, BUG-AUTH-3).

## 6. Owner manages app end-users — Partial

KC-layer capability works (admin API): `VIEW` -> 200; `disable (PUT enabled:false)` -> 204, then
ROPC -> "Account disabled"; `DELETE` -> 204, user gone.

**Falcone API surface is incomplete:**
- Tenant-owner family `/v1/tenants/{tenantId}/users` = **create + list ONLY** (both scoped by
  `canManageTenant`: `identity.tenantId === tenant.id`). No disable, no delete, no role mgmt.
- Superadmin IAM family `/v1/iam/realms/{realmId}/users` = create + list + role/group assignment.
  The catalog (`public-route-catalog.json`) defines `DELETE …/users/{id}` and
  `PATCH …/users/{id}/status`, but the live runtime returns **NO_ROUTE 404** for both — not
  implemented:
  ```
  DELETE $CP/v1/iam/realms/{realm}/users/{id}        -> 404 NO_ROUTE
  PATCH  $CP/v1/iam/realms/{realm}/users/{id}/status -> 404 NO_ROUTE
  ```
So owner-driven disable/delete of app end-users is not reachable through any Falcone API; only via
raw Keycloak admin. See BUG-AUTH-1.

---

## CRITICAL ISOLATION PROBES — verdict: PASS (deny by default)

Tenant-owner tokens authenticate against the **platform realm** (`in-falcone-platform`) carrying
`tenant_id` + `tenant_owner`; app end-user tokens authenticate against the **per-tenant realm**.

| Probe | Request | Result |
|---|---|---|
| Cross-tenant realm users (IAM route) | acme-ops (tenant_owner) `GET /v1/iam/realms/$TB_TENANT/users` | **403 FORBIDDEN "requires superadmin"** |
| Cross-tenant tenant users (tenant route) | acme-ops `GET /v1/tenants/$TB_TENANT/users` | **403 "requires superadmin or tenant owner/admin of this tenant"** |
| Control (own tenant) | acme-ops `GET /v1/tenants/$TA_TENANT/users` | **200** (acme's users only) |
| Superadmin cross-tenant (by design) | superadmin `GET /v1/iam/realms/$TB_TENANT/users` | **200** (platform-wide; expected) |
| Cross-realm login | acme end-user creds → `realms/$TB_TENANT/…/token` | **DENY invalid_grant "Invalid user credentials"** (user not in globex realm) |
| Cross-tenant end-user TOKEN → resource | new-tenant end-user JWT → `GET …/workspaces/$TB_WS/data/$TB_DB/…/rows` | **403 CROSS_TENANT_VIOLATION "Workspace does not belong to the caller's tenant"** |
| Control (own resource) | same JWT → own workspace rows | **200** |

**Auth-config isolation:** even though the *template* is shared (code-defined), each project's
realm is fully isolated — separate user directory (acme end-user cannot log into globex), separate
client/social config (0 IdPs in each fixture realm; the google IdP I added existed only in the
throwaway realm and was purged), and separate `tenant_id` stamping. The executor derives `tenant_id`
from the cryptographically-verified issuer (realm name), so a tenant-A token cannot claim tenant-B.

No cross-tenant leakage found. Isolation verdict: **PASS**.

---

## BUGS

- **BUG-AUTH-1 (P1, functional gap):** App end-user disable/delete is not reachable via any
  Falcone API. Tenant-owner route family is create+list only; the superadmin IAM
  `DELETE /v1/iam/realms/{realm}/users/{id}` and `PATCH …/status` are defined in
  `public-route-catalog.json` but return **NO_ROUTE 404** in the live runtime
  (`deploy/kind/control-plane/routes.mjs` registers no DELETE/status handler). Repro:
  `DELETE $CP/v1/iam/realms/{realm}/users/{anyId}` with superadmin JWT → 404.
- **BUG-AUTH-2 (P2, template drift):** `tenantRealmTemplate.requiredClientScopes`
  (tenant-context/workspace-context/plan-context/workspace-roles) from the chart are NOT applied
  to tenant realms by the runtime `kc-admin.mjs::createRealm`. Fresh tenant realms have only stock
  KC client-scopes. Repro: create tenant via `POST /v1/tenants`, then
  `GET admin/realms/{realm}/client-scopes` — custom scopes absent (present only in platform realm).
- **BUG-AUTH-3 (P2, missing owner surface):** No Falcone control-plane route to manage a project's
  identity providers (social login) or auth-method configuration. Enabling Google/GitHub requires
  the raw Keycloak admin API; a tenant owner has no first-class API. (`public-route-catalog.json`
  has no `identity-provider` / auth-method-config family.)
- **BUG-AUTH-4 (P1, stranded fixtures — env-specific, NOT a code bug):** Pre-fix tenant realms
  (acme/globex) lack the `{slug}-app` client, so their app end-users cannot obtain a token. The
  code fix (A3) is deployed for new tenants; existing realms need a backfill
  (`provision-tenant-auth.sh`). File as an operational/migration item, not a source defect.

## What I could NOT fully test
- A complete external social-OAuth round-trip (no real Google/GitHub IdP credentials) — verified
  only the config surface + login-option reflection, which is the testable boundary.
- App end-user **self-registration** (`registrationAllowed=false` on every realm by default; the
  `/v1/auth/signups` family is the *console operator* signup, not app-end-user self-service).
  End-users are provisioned by the owner/superadmin (IAM route), not self-registered.
- IAM realm CRUD top-level routes (`GET/POST /v1/iam/realms`) — return **NO_ROUTE 404** in the
  live runtime (catalog-only); realm lifecycle is driven by the tenant routes instead.

## Cleanup performed
- Purged throwaway tenant `lcauth29833` via `POST /v1/tenants/{id}/purge` → dropped its workspace,
  the `wsdb_lcauth29833_lcwsauth` database, and deleted its realm (cascading all test users + the
  google IdP). Verified the realm is gone.
- Deleted a residual `lcuser19513@acme.test` (lc-prefixed) from the acme realm → TA back to 4 users.
- Fixture realms verified intact: acme=4 users/0 idps/6 clients, globex=4 users/0 idps/6 clients.
