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
| MongoDB  | `mongodb://localhost:57017/?replicaSet=rs0&directConnection=true` (`MONGO_URI` / `MONGO_TEST_URI`) | document store; single-node replica set `rs0` (**required** for CDC change streams); ephemeral (tmpfs); `rs.initiate()` + wait-for-PRIMARY on `up` |
| MinIO    | `http://localhost:59000` S3 API / `http://localhost:59001` console (`minioadmin`/`minioadmin`) | S3-compatible object storage (`S3_ENDPOINT`); ephemeral (tmpfs); bucket `falcone-test` (`S3_SDK_BUCKET`) created on `up` |
| Vault    | `http://localhost:58200` (token `root`) (`VAULT_ADDR`/`VAULT_TOKEN`) | dev mode (auto-unsealed); file audit device → host-mounted log at `tests/env/vault/audit/vault-audit.log` (`VAULT_AUDIT_LOG_PATH`), tailed by `secret-audit-handler` |

### What each new service is for

- **MongoDB** — the document store collected by `provisioning-orchestrator`
  (`collectors/mongo-collector.mjs`) and the source of CDC change streams consumed
  by `mongo-cdc-bridge` (`src/index.mjs`, reads `MONGO_TEST_URI`/`MONGO_URI`).
  MongoDB change streams require a replica set, so the node runs as single-node
  `rs0` and `up.sh` initiates it and waits until it is PRIMARY.
- **MinIO** — S3-compatible object storage for workspace SDK artifacts
  (`openapi-sdk-service`, reads `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` /
  `S3_SDK_BUCKET`) and storage-config export (`provisioning-orchestrator`
  `collectors/s3-collector.mjs`). `up.sh` creates the `falcone-test` bucket.
- **Vault** — secret store. Its only test-relevant job is emitting a **file**
  audit log to a host-mounted path that `secret-audit-handler` (`src/index.mjs`,
  reads `VAULT_AUDIT_LOG_PATH`) tails and republishes. `up.sh` enables the file
  audit device and generates an audit entry so the host log file exists.

### Bootstrap performed by `up.sh` (idempotent)

- **MongoDB**: `rs.initiate({_id:'rs0', members:[{host:'mongodb:27017'}]})` if the
  set is not already configured, then waits until `rs.status().myState == 1`
  (PRIMARY).
- **MinIO**: `mc alias set local … && mc mb --ignore-existing local/falcone-test`
  (run with the in-container `mc` client).
- **Vault**: `vault audit enable file file_path=/vault/audit/vault-audit.log`
  ("already enabled" is ignored), then a `vault kv get` / `vault token lookup` to
  guarantee the host-visible audit log file is non-empty.

### Out of scope (these stay on the Kubernetes/Helm path)

- **OpenWhisk / functions** — too heavy to run under docker compose.
- **The Falcone app + APISIX gateway containers** — there are no Dockerfiles for
  them; in these tests the Falcone microservices run **in-process** (specs import
  the service `.mjs` and hit this live backing infra).
- **Observability** (metrics/tracing/logging stack).

These remain covered by the Helm chart / real-stack E2E (`tests/e2e`).
| action-runner | `http://localhost:8090` (`/healthz`) | TEST-ONLY HTTP shim that runs real product actions with per-route dependency injection (HTTP-slice only) |
| APISIX   | `http://localhost:9080` (`/v1/scheduling/*`, `/v1/async-operations`, `/v1/admin/config/format-versions`, `/v1/plans`, `/v1/quota-dimensions`, `/v1/tenant/entitlements`) | API gateway: validates the Keycloak JWT and injects identity headers (HTTP-slice only) |

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

## HTTP request-chain slice (multiple action families)

`up.sh` also boots an **API-level vertical slice** that runs Falcone's real HTTP
request chain end-to-end for several action families:

```
Keycloak (JWT)  ->  APISIX (auth + identity-header inject)  ->  action-runner shim
                ->  product action (real, imported as-is)  ->  Postgres
```

Families behind the gateway (each exercised by the smoke test):

| Family | Route(s) | Product action (imported as-is) | Invoke style / deps |
|--------|----------|---------------------------------|---------------------|
| scheduling | `/v1/scheduling/*` | `scheduling-engine/actions/scheduling-management.mjs` | `params-pg` — `params.pg` = pg Pool |
| async-operation | `POST/GET /v1/async-operations`, `GET /v1/async-operations/{id}` | `provisioning-orchestrator/src/actions/async-operation-create.mjs` + `async-operation-query.mjs` | `params-overrides` — `main(params, overrides)`, `overrides.db` = pg Pool |
| tenant-config formats | `GET /v1/admin/config/format-versions` | `provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs` | `params-only` — pure GET, no DB |
| plan catalog | `POST /v1/plans`, `GET /v1/plans` | `provisioning-orchestrator/src/actions/plan-create.mjs` + `plan-list.mjs` | `params-callercontext-overrides` — `main(params, overrides)`, `overrides.db` = pg Pool, `params.callerContext` built from headers; **superadmin only** |
| quota dimensions | `GET /v1/quota-dimensions` | `provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext`; **superadmin only** |
| tenant entitlements | `GET /v1/tenant/entitlements` | `provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext`, `?tenantId` flattened (`mergeQueryIntoParams`); **first tenant-scoped family** — a `tenant_owner` reads only its own tenant (cross-tenant `?tenantId` → 403); superadmin may cross-scope |

| Piece | Where | What it does |
|-------|-------|--------------|
| action-runner shim | `action-runner/` (`server.mjs`, `routes.mjs`, `Dockerfile`) | node:http server. Adapts a plain HTTP request into the OpenWhisk-style `params` actions read (`__ow_headers`, `method`, `path`, `query`, `body`) and invokes each **product action as-is** (imported from the repo bind-mounted read-only at `/repo`), returning its `{statusCode, headers?, body}`. The route table (`routes.mjs`) is data-driven AND declares **per-route dependency injection** (`invoke` style + `deps`) so actions with different DI models — `params.pg`, `main(params, overrides)`, or no deps — coexist behind one shim. Routes can also opt into OpenWhisk-style flattening of the query string / JSON body into top-level params (`mergeQueryIntoParams` / `mergeBodyIntoParams`) and supply `defaults` (e.g. `queryType`). |
| APISIX | `apisix/config.yaml` (standalone YAML mode), `apisix/apisix.yaml` (routes) | Gateway for all slice routes. `openid-connect` (bearer-only) validates the Keycloak access token; a `serverless-pre-function` then strips any client-supplied `x-*` identity headers and re-injects them from the **verified** token claims; `proxy-rewrite` forwards to the shim. The same plugin chain is inlined per route (APISIX's tinyyaml parser does not support YAML anchors). |
| Keycloak realm | `keycloak-e2e-provision.sh` | Realm `falcone-e2e`, public ROPC client `falcone-e2e-client`, and two users: `e2e-user`/`e2e-password` (role `scheduling.admin`, attributes `actor_type=tenant_owner` + `actor_scopes=platform:admin:config:export`) for the scheduling/async-operation/tenant-config families **and the tenant-scoped entitlements family** (a `tenant_owner` reads only its own tenant), and `e2e-superadmin`/`e2e-superadmin-password` (`actor_type=superadmin`) for the plan/quota families (and superadmin cross-scope entitlements reads). Both reuse the same client claim mappers (see below). |

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
bash tests/env/e2e-smoke/run.sh        # curl/node: per family 401 -> token -> create -> read-back
( cd tests/env/e2e-smoke && npm install && npx playwright test )   # same flows via @playwright/test request API
```

The smoke run covers all six families end-to-end:
- **scheduling** — 401 unauthenticated, then `POST /v1/scheduling/jobs` → 201, then listed.
- **async-operation** — 401 unauthenticated, `POST /v1/async-operations` → 200 (the
  action's `formatCreateResponse` contract returns **200**, not 201), then
  `GET /v1/async-operations/{id}` detail returns it, then it appears in the list.
- **tenant-config formats** — 401 unauthenticated, then
  `GET /v1/admin/config/format-versions` → 200 with `current_version` + non-empty `versions`.
- **plan catalog** — 401 unauthenticated, then a **negative authZ probe** (the
  `tenant_owner` user `POST /v1/plans` → **403**, proving the superadmin gate is
  real), then the `e2e-superadmin` user `POST /v1/plans` → 201 and the created plan
  appears in `GET /v1/plans`.
- **quota dimensions** — 401 unauthenticated, then the `e2e-superadmin` user
  `GET /v1/quota-dimensions` → 200 with the seeded catalog (≥ 8 dimensions,
  including `max_workspaces`, from migration `098-plan-base-limits.sql`).
- **tenant entitlements** (the **first tenant-scoped family**, with a cross-tenant
  **IDOR probe**) — 401 unauthenticated, then the `tenant_owner` `e2e-user`
  `GET /v1/tenant/entitlements` → 200 (its own tenant; an unseeded tenant yields a
  non-empty `quantitativeLimits` array of `catalog_default` rows and `planSlug:null`),
  then the **IDOR probe** `GET /v1/tenant/entitlements?tenantId=<TENANT_B>` → **403**
  (a `tenant_owner` may read only its own tenant; the action throws `FORBIDDEN`
  before any DB access, so `TENANT_B` need not exist), then the `e2e-superadmin`
  `GET /v1/tenant/entitlements?tenantId=<own tenant>` → 200 (a superadmin may
  cross-scope). The Playwright mirror is `tenant-entitlements-http-slice.spec.ts`.

### How identity flows (claims -> headers)

Most actions derive identity **only** from trusted gateway-injected headers
(`scheduling-management.mjs::parseIdentity`, `async-operation` `caller-context.mjs`,
`tenant-config` `parseConfigIdentity`). The **plan/quota** actions instead read a
pre-built `params.callerContext.actor` object directly — they do **not** re-derive
it from `__ow_headers`. In the real system a trusted HTTP handler builds that
object from the gateway headers before dispatch; the slice's shim does the same in
its `params-callercontext-overrides` invoke style (`buildCallerContextFromHeaders`
in `action-runner/server.mjs`), **overwriting** any client-supplied `callerContext`
so the request body can never spoof identity. The slice produces the headers like this:

- **Keycloak mappers** (`keycloak-e2e-provision.sh`) put these on the *access token*:
  - `tenant_id`, `workspace_id` — `oidc-usermodel-attribute-mapper` from the user's
    `tenant_id` / `workspace_id` attributes (realm has `unmanagedAttributePolicy=ENABLED`
    so Keycloak 26 does not strip them).
  - `actor_roles` — `oidc-usermodel-realm-role-mapper` (multivalued, unprefixed), includes `scheduling.admin`.
  - `actor_type` — `oidc-usermodel-attribute-mapper` from the user's `actor_type`
    attribute. `e2e-user` is `tenant_owner` (required by the async-operation create
    model, which only accepts `{workspace_admin, tenant_owner, superadmin,
    tenant_member}`); `e2e-superadmin` is `superadmin` (required by the plan/quota
    actions, which compare `actor.type === 'superadmin'`). `superadmin` is the one
    value identical across both conventions, so a single superadmin user satisfies
    both contracts.
  - `actor_scopes` — `oidc-usermodel-attribute-mapper` (multivalued) from the user's
    `actor_scopes` attribute (`platform:admin:config:export`; required by the
    tenant-config format-versions action).
  - `sub` — standard subject.
- **APISIX** (`apisix/apisix.yaml`): `openid-connect` validates the token, then the
  `serverless-pre-function` decodes the verified token and sets upstream headers
  `X-Tenant-Id <- tenant_id`, `X-Workspace-Id <- workspace_id`,
  `X-Auth-Subject <- sub`, `X-Actor-Roles <- actor_roles` (joined),
  `X-Actor-Type <- actor_type`, `X-Actor-Scopes <- actor_scopes` (joined). It first
  deletes any caller-supplied `X-*` identity headers, so a client cannot spoof identity.

### Scope / deferred (honest)

- **Families covered: scheduling, async-operation, tenant-config format-versions,
  plan catalog (create/list), quota dimension catalog (list), tenant effective
  entitlements (get).** The route table (`action-runner/routes.mjs`) is data-driven
  with per-route DI; other actions can be added the same way (declare `invoke` +
  `deps`).
- **tenant effective entitlements — first tenant-scoped family + IDOR probe.**
  Every prior family is either tenant-agnostic or superadmin-only; this is the
  first family whose authorization is **per-tenant** (a `tenant_owner` may read
  only its own tenant). The action reads `params.callerContext.actor` and rejects a
  cross-tenant `?tenantId` mismatch with `FORBIDDEN`/403 **before any DB access**,
  so the smoke's IDOR probe (`?tenantId=22222222-…` as `e2e-user`) proves
  cross-tenant isolation without seeding a second tenant. The positive own-tenant
  read uses an unseeded tenant: `resolveUnifiedEntitlements` LEFT JOINs the
  catalog/plan-assignment/override tables and returns one `catalog_default`
  quantitative limit per `quota_dimension_catalog` dimension with `planSlug:null`.
  This family needs three more migrations than the plan/quota families —
  `100-plan-change-impact-history` (loop dependency ordering), `103-hard-soft-quota-overrides`
  (the `quota_overrides` table the entitlements query LEFT JOINs), and
  `104-plan-boolean-capabilities` (the optional `boolean_capability_catalog`; its
  `42P01` is caught, but seeding it exercises the full capability-resolution path)
  — all applied idempotently by `up.sh` after 097/098.
- **plan/quota identity model.** Unlike the other families, the plan/quota actions
  read `params.callerContext.actor` directly instead of re-deriving it from
  `__ow_headers`. The shim builds `callerContext` from the trusted gateway headers
  (`params-callercontext-overrides`) and overwrites any client value — faithful to
  the gateway-as-trust-boundary model. The smoke includes a negative probe
  (`tenant_owner` → 403 on `POST /v1/plans`) so the superadmin gate is verified, not
  assumed.
- **quota-override-list / quota-effective-limits-get: deferred.** Their repositories
  (`quota-override-repository.mjs::listOverrides`, `quota-enforcement-repository.mjs`)
  operate on an **in-memory store** (`db._quotaOverrides`, `ensureStores(db)`) rather
  than issuing SQL against a pg Pool, so they are not wireable end-to-end through the
  shim's shared Pool without a fake-db adapter. `quota-dimension-catalog-list` was
  chosen for the quota family precisely because its repository issues real SQL
  (`SELECT … FROM quota_dimension_catalog`) against the Pool. `plan-get` (superadmin
  or tenant-owner, real SQL) is wireable too but was left out to keep the slice to
  one create+list pair per family.
- **async-operation `result` queryType + idempotency-key path: deferred.** The
  `getOperationResult` query selects `result`/`completed_at` columns no migration
  in this repo adds to `async_operations`, and the idempotency-key create path runs
  `BEGIN/COMMIT` across a shared pool (no single-connection guarantee). The slice
  therefore exercises create (no idempotency key), `detail`, and `list`, which use
  only columns the applied migrations (073/075/076/078) provide.
- **Custom scope-enforcement Lua plugin: deferred** (out of scope for this slice).
  APISIX here does AuthN + identity-header injection, not the fine-grained
  per-resource scope checks the production gateway plugin performs.
- **Web-console UI: deferred** — the console backend is not present in this repo,
  so the slice is API-level only.

## Extending

- **More backing services**: add them to `docker-compose.yml`, expose host ports
  with a healthcheck consistent with the existing services (so `up.sh`'s health
  loop works), wire any bootstrap into `up.sh`, and export their endpoints in
  `env.sh`. (Postgres, Keycloak, Redpanda, MongoDB, MinIO and Vault are already
  provided.)
- **More backing services** (Vault, MinIO, MongoDB): add them to
  `docker-compose.yml`, expose host ports, and export their endpoints in `env.sh`.
- **More slice routes**: add a `{ name, methods, pathRegex, module, exportName, invoke, deps? }`
  entry to `action-runner/routes.mjs` (the shim imports the module from the
  bind-mounted repo) and an APISIX route in `apisix/apisix.yaml`. Pick the `invoke`
  style that matches how the action takes its dependencies (`params-pg`,
  `params-overrides` + `deps: ['db']`, or `params-only`), and set
  `mergeQueryIntoParams` / `mergeBodyIntoParams` / `defaults` if the action reads
  flat top-level params (OpenWhisk web-action style).
- **More seeded tenants**: drop another `keycloak/import/<id>-realm.json` (realm
  name = tenantId, with a `displayName`).
- **Full API integration** (tests that need a service's HTTP API, e.g. the
  backup-status `test/integration/*-api.test.ts`): also start the service pointed
  at `DB_URL` / `KEYCLOAK_*` and export `API_BASE_URL` + test tokens.
