# Falcone test environment (`tests/env`)

A `docker compose` stack of the **real backing services** Falcone runs in-cluster,
so changes can be exercised against real infrastructure instead of mocks. This is
the preferred local integration target (lighter than a throwaway Kubernetes).

## What it provides

| Service  | Host endpoint                                   | Notes |
|----------|-------------------------------------------------|-------|
| Postgres | `postgres://falcone:falcone@localhost:55432/falcone_test` | ephemeral (tmpfs); backup-status + scheduling-engine migrations applied on `up` |
| Keycloak | `http://localhost:8081` (admin `admin`/`admin`) | internal IdP; tenants map 1:1 to realms; also hosts the slice realm `falcone-e2e` |
| Redpanda | `localhost:19092` (`KAFKA_BROKERS`) | Kafka API broker (events, audit, CDC change streams); auto-creates topics |
| action-runner | `http://localhost:8090` (`/healthz`) | TEST-ONLY HTTP shim that runs the real scheduling action with a real pg Pool (HTTP-slice only) |
| APISIX   | `http://localhost:9080` (`/v1/scheduling/*`) | API gateway: validates the Keycloak JWT and injects identity headers (HTTP-slice only) |

### Keycloak model (matches production)

In Falcone the **Keycloak realm name equals the `tenantId`** (see
`services/provisioning-orchestrator/src/reprovision/identifier-map.mjs::deriveIamRealm`),
and a realm's **`displayName`** is the authoritative human-readable tenant name.

`up.sh` provisions a master-realm **admin service account** (`falcone-admin`,
secret `falcone-admin-secret`, granted the realm `admin` role) — the same
client-credentials → admin-API pattern `provisioning-orchestrator` uses, and what
the chart provisions as the `in-falcone-keycloak-admin` secret.

Seeded tenant realms (`keycloak/import/*.json`):

| tenantId (realm)                         | displayName        |
|------------------------------------------|--------------------|
| `11111111-1111-1111-1111-111111111111`   | Acme Corporation   |
| `22222222-2222-2222-2222-222222222222`   | Globex Industries  |

## Lifecycle

```bash
bash tests/env/up.sh      # start, wait for health, provision Keycloak, migrate Postgres
source tests/env/env.sh   # export DB_URL / KEYCLOAK_* / seeded tenant ids into your shell
bash tests/env/run.sh     # run the real-stack tests against the live env
bash tests/env/down.sh    # tear down (containers + ephemeral data)
```

`up.sh` is idempotent. `env.sh` is the single source of truth for the endpoints
and credentials; tests and ad-hoc probes should `source` it.

## Writing real-stack tests

Place them under a service's `test/integration/` and **gate them on the env marker**
so the normal unit suite stays green when the env is not running:

```ts
const RUN = process.env.FALCONE_TESTENV === '1' && !!process.env.KEYCLOAK_BASE_URL
describe.skipIf(!RUN)('... vs REAL Keycloak', () => { /* uses real fetch, no mocks */ })
```

Reference: `services/backup-status/test/integration/tenant-name-resolver.keycloak.test.ts`
drives the actual `createKeycloakTenantNameResolver` against the live Keycloak
(real client-credentials flow + admin API) and asserts the fail-closed contract.

## HTTP request-chain slice (scheduling)

`up.sh` also boots an **API-level vertical slice** that runs Falcone's real HTTP
request chain end-to-end:

```
Keycloak (JWT)  ->  APISIX (auth + identity-header inject)  ->  action-runner shim
                ->  scheduling-management action (real, imported as-is)  ->  Postgres
```

| Piece | Where | What it does |
|-------|-------|--------------|
| action-runner shim | `action-runner/` (`server.mjs`, `routes.mjs`, `Dockerfile`) | node:http server. Adapts a plain HTTP request into the OpenWhisk-style `params` the action reads (`__ow_headers`, `method`, `path`, `query`, `body`) and injects a real `pg` Pool at `params.pg`, then dynamically `import()`s the **product action as-is** from the repo bind-mounted read-only at `/repo` and returns its `{statusCode, body}`. Route table is data-driven (`routes.mjs`) so more services can be added. |
| APISIX | `apisix/config.yaml` (standalone YAML mode), `apisix/apisix.yaml` (route) | Gateway for `/v1/scheduling/*`. `openid-connect` (bearer-only) validates the Keycloak access token; a `serverless-pre-function` then strips any client-supplied `x-*` identity headers and re-injects them from the **verified** token claims; `proxy-rewrite` forwards to the shim. |
| Keycloak realm | `keycloak-e2e-provision.sh` | Realm `falcone-e2e`, public ROPC client `falcone-e2e-client`, user `e2e-user`/`e2e-password`, role `scheduling.admin`, and claim mappers (see below). |

### Boot + hit the API

```bash
bash tests/env/up.sh          # boots backing services + the slice, provisions Keycloak
source tests/env/env.sh        # exports APISIX_BASE_URL, E2E_REALM/CLIENT/USER/PASSWORD, E2E_TENANT_ID/...

# 1) get an access token (Resource Owner Password grant)
TOKEN=$(curl -s -X POST \
  "$KEYCLOAK_BASE_URL/realms/$E2E_REALM/protocol/openid-connect/token" \
  -d grant_type=password -d "client_id=$E2E_CLIENT_ID" \
  -d "username=$E2E_USERNAME" -d "password=$E2E_PASSWORD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 2) call the gateway (no token -> 401)
curl -s -o /dev/null -w '%{http_code}\n' "$APISIX_BASE_URL/v1/scheduling/jobs"           # 401

# 3) enable scheduling, create a job, list it (authenticated)
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X PATCH "$APISIX_BASE_URL/v1/scheduling/config" -d '{"schedulingEnabled":true}'
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST  "$APISIX_BASE_URL/v1/scheduling/jobs"   -d '{"name":"nightly","cronExpression":"0 2 * * *","targetAction":"reports/build"}'   # 201
curl -s -H "Authorization: Bearer $TOKEN" "$APISIX_BASE_URL/v1/scheduling/jobs"          # lists it
```

### Smoke tests

```bash
bash tests/env/e2e-smoke/run.sh        # curl/node: 401 -> token -> 201 -> listed
( cd tests/env/e2e-smoke && npm install && npx playwright test )   # same flow via @playwright/test request API
```

### How identity flows (claims -> headers)

The action derives identity **only** from trusted gateway-injected headers
(`scheduling-management.mjs::parseIdentity`). The slice produces them like this:

- **Keycloak mappers** (`keycloak-e2e-provision.sh`) put these on the *access token*:
  - `tenant_id`, `workspace_id` — `oidc-usermodel-attribute-mapper` from the user's
    `tenant_id` / `workspace_id` attributes (realm has `unmanagedAttributePolicy=ENABLED`
    so Keycloak 26 does not strip them).
  - `actor_roles` — `oidc-usermodel-realm-role-mapper` (multivalued, unprefixed), includes `scheduling.admin`.
  - `sub` — standard subject.
- **APISIX** (`apisix/apisix.yaml`): `openid-connect` validates the token, then the
  `serverless-pre-function` decodes the verified token and sets upstream headers
  `X-Tenant-Id <- tenant_id`, `X-Workspace-Id <- workspace_id`,
  `X-Auth-Subject <- sub`, `X-Actor-Roles <- actor_roles` (joined). It first deletes
  any caller-supplied `X-*` identity headers, so a client cannot spoof identity.

### Scope / deferred (honest)

- **Scope: scheduling only.** The route table (`action-runner/routes.mjs`) is
  data-driven; other services can be added the same way.
- **Custom scope-enforcement Lua plugin: deferred** (out of scope for this slice).
  APISIX here does AuthN + identity-header injection, not the fine-grained
  per-resource scope checks the production gateway plugin performs.
- **Web-console UI: deferred** — the console backend is not present in this repo,
  so the slice is API-level only.

## Extending

- **More backing services** (Vault, MinIO, MongoDB): add them to
  `docker-compose.yml`, expose host ports, and export their endpoints in `env.sh`.
- **More slice routes**: add a `{ method, pathRegex, module, exportName }` entry to
  `action-runner/routes.mjs` (the shim imports the module from the bind-mounted repo)
  and an APISIX route in `apisix/apisix.yaml`.
- **More seeded tenants**: drop another `keycloak/import/<id>-realm.json` (realm
  name = tenantId, with a `displayName`).
- **Full API integration** (tests that need a service's HTTP API, e.g. the
  backup-status `test/integration/*-api.test.ts`): also start the service pointed
  at `DB_URL` / `KEYCLOAK_*` and export `API_BASE_URL` + test tokens.
