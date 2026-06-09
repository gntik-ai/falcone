# Falcone test environment (`tests/env`)

A `docker compose` stack of the **real backing services** Falcone runs in-cluster,
so changes can be exercised against real infrastructure instead of mocks. This is
the preferred local integration target (lighter than a throwaway Kubernetes).

## What it provides

| Service  | Host endpoint                                   | Notes |
|----------|-------------------------------------------------|-------|
| Postgres | `postgres://falcone:falcone@localhost:55432/falcone_test` | ephemeral (tmpfs); backup-status migrations applied on `up` |
| Keycloak | `http://localhost:8081` (admin `admin`/`admin`) | internal IdP; tenants map 1:1 to realms |
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

## Extending

- **More backing services**: add them to `docker-compose.yml`, expose host ports
  with a healthcheck consistent with the existing services (so `up.sh`'s health
  loop works), wire any bootstrap into `up.sh`, and export their endpoints in
  `env.sh`. (Postgres, Keycloak, Redpanda, MongoDB, MinIO and Vault are already
  provided.)
- **More seeded tenants**: drop another `keycloak/import/<id>-realm.json` (realm
  name = tenantId, with a `displayName`).
- **Full API integration** (tests that need a service's HTTP API, e.g. the
  backup-status `test/integration/*-api.test.ts`): also start the service pointed
  at `DB_URL` / `KEYCLOAK_*` and export `API_BASE_URL` + test tokens.
