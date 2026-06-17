# Evidence — Capability #12: Web Console + API↔Console parity (live kind stack)

Deployed: `falcone-web-console` image `localhost:30500/in-falcone-web-console:0.2.11`,
chart `webConsole-0.2.0`, 2 replicas Running, container port 3000 (pure static host),
build version meta `dev`. Tested via port-forward `http://127.0.0.1:13000`, driven with
Playwright (system Google Chrome `/opt/google/chrome/chrome` — the pinned Playwright
chromium has no ubuntu-26.04 build).

## Summary verdict

- **Console reachable:** YES (SPA + JS bundle served, 200).
- **Login as superadmin:** WORKS end-to-end (redirects to `/console/overview`).
- **Admin pages exercised:** overview, tenants, workspaces, plans, iam-access, members — all
  render the protected shell with real data.
- **API↔Console parity:** HOLDS. The console is a thin client over the same control-plane
  `/v1/*` endpoints; lists and fields match; an API-created tenant appears in the console.
- **Blocked / testability constraint:** the SPA targets hardcoded ingress hostnames that don't
  resolve here AND no ingress controller is deployed — worked around with Playwright `page.route`.

---

## 1. Console reachability + runtime config

`GET http://127.0.0.1:13000/ → 200`, serves the built SPA:

```html
<title>In Falcone Console</title>
<script type="module" crossorigin src="/assets/index-Cl8T7T73.js"></script>
```

`/assets/index-Cl8T7T73.js → 200` (644 KB bundle). `/healthz → 200`.

**Runtime config is NOT a `/config.js` / `window.__ENV` file.** The container is configured
purely by env vars from two ConfigMaps:
- `falcone-web-console-config`: `auth = {clientId: in-falcone-console, realm: in-falcone-platform,
  loginPath:/login, signupPath:/signup, passwordRecoveryPath:/password-recovery}`,
  `homepageHost: console.dev.in-falcone.example.com`.
- `in-falcone-web-console-config`: `consoleHostname: console.dev.in-falcone.example.com`,
  `environment: dev`, `publicBasePath: /`.
- Deployment env: `NODE_ENV=production`, `PUBLIC_BASE_PATH=/`. **No `VITE_API_BASE_URL`** is set
  (Dockerfile only injects `VITE_APP_VERSION`).

**Key architectural fact — the SPA is a THIN, SAME-ORIGIN client (no API base URL).**
The single HTTP client `apps/web-console/src/lib/http.ts::requestJson` calls `fetch(url, …)` with a
**bare relative path** (`/v1/...`, `/realms/...`); `API_BASE` defaults to `''`
(`services/backupStatusApi.ts::BASE_URL = VITE_API_BASE_URL ?? ''`). The bundle contains **no**
`*.dev.in-falcone.example.com` literals and no absolute API URLs. So the browser resolves every
API call against the **page origin** (`console.dev.in-falcone.example.com`).

The console pod does **not** proxy the API: `static-server.mjs` only `listen(3000)` static files,
`nginx.conf` only `try_files … /index.html` (SPA fallback). Confirmed live:

```
GET http://127.0.0.1:13000/v1/tenants  → 200 text/html  (SPA fallback HTML, NOT JSON)
```

Therefore the console **requires an edge that routes `console.dev…/v1/*` and `/realms/*` to the
control-plane / Keycloak**. The APISIX standalone config does have host-independent `/v1/*` routes,
but the nginx **Ingress** maps `console.dev…/ → falcone-web-console` only — and **no ingress
controller is deployed** (no ingress-nginx/traefik pods, no IngressClass; the Ingress object is
inert). The realm/issuer endpoint is built relative too: the bundle constructs
``/realms/${realm}/protocol/openid-connect/token`` (same-origin).

### Testability constraint (documented, as the brief anticipated)

The SPA's same-origin `/v1/*` calls cannot be served by the console host as deployed (no edge
routes them; the hostnames don't resolve from the harness). **Worked around** in Playwright by
intercepting same-origin `^/(v1|realms|auth|api)/` requests and re-issuing them to the local
APISIX gateway (`127.0.0.1:19080`) — see *repro* below. This made the SPA fully functional.

---

## 2. Browser drive (Playwright + system Chrome) — login + admin pages

Driver loads `/login`, types `superadmin` + password (read from secret `in-falcone-superadmin`,
typed into the form, never printed), submits.

| Step | Result |
|---|---|
| `GET /login` | 200, form renders (`name=username`, `name=password`, "Entrar a la consola") |
| Submit login | **redirects to `/console/overview`** — authenticated |
| `/console/overview` | renders shell: "Platform Admin / <platform-admin@in-falcone.example.com>" |
| `/console/tenants` | "Gestión de tenants", **tenant context selector populated**, "Nuevo tenant" |
| `/console/workspaces` | renders (workspace selector populated after tenant pick: "WS Staging", "WS Prod") |
| `/console/plans` | **Plan catalog table** with real rows + "Create Plan" |
| `/console/iam-access` | renders (superadmin-guarded route) |
| `/console/members` | renders |

Network calls the SPA actually issued (all **200**): `POST /v1/auth/login-sessions`,
`GET /v1/tenants?page[size]=100&sort=displayName`, `GET /v1/plans?page=1&pageSize=20`,
`GET /v1/metrics/tenants/platform/{quotas,overview}`, `POST /v1/async-operation-query`. Zero
console JS errors.

The login page UI states its own contract: *"Autenticación respaldada por Keycloak y normalizada
por la familia pública /v1/auth/* del control plane"*, Realm `in-falcone-platform`, Client ID
`in-falcone-console` — matching the ConfigMap.

**Note on route layout:** admin pages live under `/console/*` (guarded by `ProtectedRoute`);
top-level `/tenants`, `/plans` correctly render the SPA's own *"ruta … no existe todavía"* 404.
Root `/` is a `WelcomePage` scaffold. This is expected routing, not a bug.

Screenshots (in this dir): `console-01-login.png`, `console-02-after-login.png`,
`console-03-{overview,tenants,workspaces,plans,iam-access,members}.png`,
`console-04-tenant-selected.png`, `console-05-plans.png`,
`console-06-created-tenant-visible.png`.

---

## 3. API↔Console parity (the core requirement) — HOLDS

The console calls the **same control-plane endpoints** I drive directly with `sa_token`:

**Tenants.** Console context selector ⇐ `GET /v1/tenants`. Live cross-check:
- API `GET /v1/tenants?page[size]=100` → **12 items** (envelope `{items:[…]}`).
- SPA rendered **12 tenants** in the dropdown (13 options incl. placeholder); labels match the
  API `displayName` (Ops Demo, DataPlane Demo, Acme Corp, LA Prov 909, …) and the SPA's dropdown
  values are the API `tenantId`s.
- Tenant object fields the API returns: `id, tenant_id, slug, display_name, status, iam_realm,
  created_at, created_by, tenantId, displayName, state, iamRealm, identityContext` — the console
  consumes `tenantId`/`displayName`; **no field the console shows is absent from the API**, and
  no API field is silently dropped that would matter to the list view.

**Workspaces.** After selecting a tenant the SPA fetched the tenant's workspaces and populated the
workspace selector ("WS Staging", "WS Prod") — same `/v1/tenants/{id}/workspaces` data path the
plan/workspace pages use.

**Plans.** Console Plan catalog ⇐ `GET /v1/plans?page=1&pageSize=20`. Live cross-check:
API → **7 plans** (`plan-acme-1781092159 / Acme Plan / active`, `adm-1781090483 / Admin Flow Plan`,
`cp-smoke-1 / CP Smoke Plan / draft`, …). The console table shows exactly these rows (Slug, Name,
Status, Assigned, Updated). Envelope `{plans,total,page,pageSize}`.

**Create-via-API → visible in console (end-to-end parity).** Created `POST /v1/tenants
{slug:laconsoleparity17734, displayName:"LA Console Parity 17734"}` → **201**. Reloaded the console
`/console/tenants`: the tenant **appeared in the dropdown** (count 13→14, exact label match,
`FOUND_IN_CONSOLE=true`, see `console-06-…png`). This proves the console reads the live API and is
not backed by a separate/cached store.

**Login parity.** `POST /v1/auth/login-sessions` (the exact endpoint `LoginPage` POSTs) → **201**
with `principal.platformRoles:["superadmin"]`, `tenantIds:[]`, redacted `tokenSet`. Same endpoint,
same shape, whether driven by the browser or by curl.

**Verdict:** the console is a faithful thin client over the public control-plane API. Information
is the SAME and CONSISTENT across REST and console. No console-only fields and no API-only fields
of consequence were observed for the surfaces tested (tenants, workspaces, plans, login, metrics).

---

## 4. Status classification (capability #12)

| Console functionality | Status | Evidence |
|---|---|---|
| SPA reachability / static host | **Active** | 200 root + bundle; SPA fallback confirmed |
| Superadmin OIDC/password login (`/v1/auth/login-sessions`) | **Active** | 201, redirect to `/console/overview` |
| Tenants list + context selector | **Active** | dropdown == `/v1/tenants` (12) |
| Workspaces list/selector | **Active** | populated from tenant ws endpoint |
| Plans catalog | **Active** | table == `/v1/plans` (7) |
| IAM access page (superadmin-guarded) | **Active (renders)** | route reached, no JS error |
| Members page | **Active (renders)** | route reached |
| Create tenant from console wizard | **Broken** (see CONS-1) | UI calls `/v1/admin/tenants` which 404s live |
| Tenant deletion (console + API) | **Not-deployed** (see CONS-2) | `DELETE /v1/tenants/{id}`, `…/purge` → 404 |
| End-to-end deployment via real ingress hostnames | **Not-testable** (see CONS-3) | no ingress controller; SPA same-origin /v1 unrouted |

---

## 5. Bugs / findings (severity + repro)

### CONS-1 (MEDIUM) — console "Nuevo tenant" wizard POSTs to a route that doesn't exist live

`apps/web-console/src/components/console/wizards/CreateTenantWizard.tsx` →
`submitWizardRequest('/v1/admin/tenants', …)`. The live control-plane (and APISIX, and the
392-route public catalog) expose only **`POST /v1/tenants`**, never `/v1/admin/tenants`.
Several other console admin calls also use the non-existent `/v1/admin/tenants/{id}/config/*`
prefix (`src/api/config*.ts`).
- Repro: `GET/POST /v1/admin/tenants → 404 {"code":"NO_ROUTE"}` on CP, gateway, and console-host
  routing; `/v1/tenants` works. Tenant **listing** uses the correct `/v1/tenants` (so the page
  loads), but **creating** a tenant from the console UI would 404. Mismatch between the SPA's
  expected route and the deployed API surface.

### CONS-2 (LOW / hygiene) — no tenant-deletion route wired on the live runtime

`DELETE /v1/tenants/{tenantId}` and `POST /v1/tenants/{tenantId}/purge` are in the route catalog
but return **404 NO_ROUTE** live (also `…/deactivate|suspend|archive` → 404). Consequence: the
parity-test tenant `LA Console Parity 17734` (`a5edd8c2-…`) **could not be cleaned up** — it is a
metadata-only record with no workspace/DB provisioned and a clearly-prefixed name; other audit
agents left the same `LA Prov*` residue, confirming the constraint is systemic, not a test error.

### CONS-3 (MEDIUM, deployment) — console is not edge-routable as deployed

The SPA issues **same-origin relative** `/v1/*` and `/realms/*` calls but (a) the console pod is a
pure static host (no proxy), (b) the nginx Ingress routes `console.dev…/ → web-console` only, and
(c) **no ingress controller is deployed** (Ingress object inert). With this manifest set, a real
browser hitting the console host would get HTML (not JSON) for every API call and the app would not
function. It only works when an edge co-locates `console.dev…/v1/*` onto the control-plane (the
APISIX `/v1/*` host-independent routes can do this, but the Ingress doesn't send `/v1` there). This
is the same class of "front-door not wired" gap noted for the gateway in 15-gateway-and-executor-authz.

### CONS-4 (informational / isolation) — console tenant scoping is CLIENT-SIDE only

`console-context.tsx` fetches the **full** `/v1/tenants` list, then hides rows client-side via
`filterTenantOptions(options, principal.tenantIds)`; if `tenantIds` is empty it returns ALL. For
superadmin (`tenantIds:[]`) showing all 12 is correct. **Risk:** if the control-plane returns the
full tenant list to a *non-superadmin* tenant-scoped JWT, the only thing limiting cross-tenant
visibility is cosmetic client filtering (bypassable via devtools / direct `GET /v1/tenants`). I
could not confirm/deny server-side scoping — **no non-superadmin tenant-user credential is
available** in the cluster (only `in-falcone-superadmin`). Follow-up needed: log in as a
tenant-scoped user and check whether `GET /v1/tenants` is server-filtered to their `tenantIds`.

---

## Cross-tenant isolation probe (this surface)

- Management API is authenticated: `GET /v1/tenants` and `POST /v1/tenants` **without auth → 401**
  (also 401 via APISIX). Unlike the data-plane executor (GW-1), the mgmt/console API does not trust
  spoofed headers.
- Open question recorded as **CONS-4**: tenant-list scoping for non-superadmin appears to rely on
  client-side filtering; not verifiable here for lack of a tenant-user credential.

## Repro (exact steps; no spec.sh for the interactive browser flow)

1. Ensure port-forwards: console 13000, apisix 19080, CP 18080, keycloak 18081 (already running).
2. Non-interactive parity + auth checks: `bash tests/live-audit/specs/12-console-parity.sh`
   (14/14 PASS).
3. Browser flow (needs system Chrome + the repo's playwright-core):

   ```bash
   export KUBECONFIG=./kubeconfig-test-cluster-b.yaml
   export SA_PW="$(kubectl -n falcone get secret in-falcone-superadmin -o jsonpath='{.data.password}' | base64 -d)"
   node /tmp/la-console/drive.mjs        # login + admin pages + screenshots
   WANT_NAME="<created tenant name>" node /tmp/la-console/verify-created.mjs
   ```

   The driver uses Playwright `ctx.route('**/*')` to re-issue same-origin `^/(v1|realms|auth|api)/`
   requests to `http://127.0.0.1:19080` (APISIX) with `Host: console.dev.in-falcone.example.com`,
   which is what makes the hostname-pinned SPA functional from the harness.
