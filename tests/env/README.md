# Falcone test environment (`tests/env`)

A `docker compose` stack of the **real backing services** Falcone runs in-cluster,
so changes can be exercised against real infrastructure instead of mocks. This is
the preferred local integration target (lighter than a throwaway Kubernetes).

## What it provides

| Service  | Host endpoint                                   | Notes |
|----------|-------------------------------------------------|-------|
| Postgres | `postgres://falcone:falcone@localhost:55432/falcone_test` | ephemeral (tmpfs); backup-status migrations applied on `up` |
| Keycloak | `http://localhost:8081` (admin `admin`/`admin`) | internal IdP; tenants map 1:1 to realms |

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

- **More backing services** (Kafka/Redpanda, Vault, MinIO, MongoDB): add them to
  `docker-compose.yml`, expose host ports, and export their endpoints in `env.sh`.
- **More seeded tenants**: drop another `keycloak/import/<id>-realm.json` (realm
  name = tenantId, with a `displayName`).
- **Full API integration** (tests that need a service's HTTP API, e.g. the
  backup-status `test/integration/*-api.test.ts`): also start the service pointed
  at `DB_URL` / `KEYCLOAK_*` and export `API_BASE_URL` + test tokens.
