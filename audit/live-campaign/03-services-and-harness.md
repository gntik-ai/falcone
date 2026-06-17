# Live kind deployment — components & test harness (source-derived)

> Code/config only. Derived from `charts/in-falcone/*`, `deploy/kind/*`, `apps/control-plane/src/runtime/*`, `tests/*`.
> Generated for the live E2E campaign: 2026-06-17.

## Verdict legend

- **POD** — runs as its own pod in the kind profile (Helm `component-wrapper` alias with `enabled: true`, or a hand-applied manifest under `deploy/kind/`).
- **BUNDLED** — not its own pod; its logic is re-implemented inside the kind control-plane runtime (`deploy/kind/control-plane/*.mjs`) or the cp-executor runtime (`apps/control-plane/src/runtime/*`).
- **ABSENT** — neither a pod nor bundled in the kind profile (source exists in-repo, but nothing in the kind deploy runs it).

## How the kind profile is actually assembled

1. **Helm umbrella** `charts/in-falcone` (`Chart.yaml` deps = `component-wrapper` aliases). Each datastore/app is a wrapper gated by `<alias>.enabled`. Chart defaults (`values.yaml`) ENABLED: apisix, keycloak, postgresql, documentdb, ferretdb, kafka, observability(prometheus), grafana, controlPlane, webConsole, seaweedfs. DISABLED by default: `controlPlaneExecutor`, `workflowWorker`, `temporal`, `mcp`, `eso`, `vault`.
2. **Kind overlay** `deploy/kind/values-kind.yaml` — only repoints images/secrets; the `controlPlane` image is the **hand-built runtime** `localhost:30500/in-falcone-control-plane` (`deploy/kind/control-plane`, server.mjs), NOT the repo `apps/control-plane` action modules.
3. **Hand-applied manifests** (kubectl, NOT Helm): `deploy/kind/executor-demo.yaml` → the **cp-executor** pod (`in-falcone-control-plane-executor:0.9.3` = `apps/control-plane/src/runtime`); Knative `ksvc fn-primary-multiplier` (deploy/kind/knative + fn-handlers). APISIX runs `APISIX_STAND_ALONE=true` with the route table `deploy/kind/apisix/apisix.yaml`.
4. **APISIX upstreams are ONLY 4 services**: `falcone-control-plane`, `falcone-cp-executor`, `falcone-keycloak`, `falcone-web-console` (`deploy/kind/apisix/apisix.yaml`). No route targets any other `services/*` pod — corroborates that no other backend microservice exists in the cluster.

## Component table (each `services/*` and `apps/*` dir)

| Dir | Verdict | Evidence |
|---|---|---|
| `apps/control-plane` (runtime) | **POD** (cp-executor) | `deploy/kind/executor-demo.yaml` Deployment `falcone-cp-executor`, image `in-falcone-control-plane-executor:0.9.3` = `apps/control-plane/src/runtime/main.mjs`. APISIX `/v1/{postgres,mongo,events,functions,realtime,workspaces}/*` → cp-executor. |
| `apps/web-console` | **POD** | chart `webConsole.enabled: true`; `values-kind.yaml webConsole.image = in-falcone-web-console:0.2.11`; APISIX `/*` → falcone-web-console. |
| `apps/cli` | **ABSENT** | dev CLI; no chart dep, no manifest. |
| `apps/console` | **ABSENT** | no chart dep/manifest (web-console is the live SPA). |
| `apps/mcp-server-sdk` | **ABSENT** | library; MCP engine env-gated OFF (see below); `mcp.enabled: false`. |
| `services/adapters` | **BUNDLED** (library) | pure builders imported into both runtimes (e.g. `mongodb-data-api.mjs`, `keycloak-admin.mjs`); the kind control-plane re-implements the live paths in `deploy/kind/control-plane/{kc-admin,storage-handlers,kafka-handlers,mongo-handlers,pg-handlers}.mjs`. Not a pod. |
| `services/internal-contracts` | **BUNDLED** (library) | schemas/state machines consumed by handlers; not a pod. |
| `services/gateway-config` | **BUNDLED** (config) | `public-api-routing.yaml` is the source for the APISIX route table; not a pod. |
| `services/keycloak-config` | **BUNDLED** (config) | realm/role config materialized by the (disabled) bootstrap hook + `tests/env/keycloak/import`; not a pod. |
| `services/provisioning-orchestrator` | **BUNDLED** (partial) | saga is re-implemented in `deploy/kind/control-plane/{saga.mjs,b-handlers.mjs,kc-admin.mjs}` (createTenant/createWorkspace/purgeTenant + durable saga + recoverSagas). The standalone orchestrator service is NOT a pod. Appliers (kafka/mongo/storage/functions) are NOT all wired. |
| `services/workflow-worker` | **ABSENT** | chart dep `workflowWorker.enabled: false`; needs Temporal (`temporal.enabled: false`, not on kind). cp-executor flowExecutor gated on `TEMPORAL_ADDRESS` (unset). |
| `services/event-gateway` | **ABSENT** (logic BUNDLED) | no pod; only a rate-limit-class name appears in chart values. Events logic re-implemented in `deploy/kind/control-plane/kafka-handlers.mjs` + cp-executor `events-executor.mjs` (KAFKA_BROKERS set). |
| `services/realtime-gateway` | **ABSENT** | no pod, no chart ref. Realtime is NOT live — see capability conclusion. |
| `services/scheduling-engine` | **ABSENT** | no pod, no chart ref, no bundled handler. |
| `services/webhook-engine` | **ABSENT** | no pod, no chart ref, no bundled handler. |
| `services/pg-cdc-bridge` | **ABSENT** | no pod, no chart ref. (cp-executor has a `postgres-realtime-executor` but it is OFF in kind.) |
| `services/mongo-cdc-bridge` | **ABSENT** | has a Dockerfile but no chart dep/manifest; not deployed. |
| `services/audit` | **ABSENT** | no pod; only incidental string matches in bootstrap configmaps. Metrics/audit *views* are bundled read-only in control-plane `metrics-handlers.mjs`. |
| `services/secret-audit-handler` | **ABSENT** | no pod, no chart ref (Vault disabled on kind). |
| `services/audit-anomaly-handler` | **ABSENT** | no pod, no chart ref. |
| `services/backup-status` | **ABSENT** | no pod, no chart ref. |
| `services/billing-export` | **ABSENT** | no pod, no chart ref. |
| `services/openapi-sdk-service` | **ABSENT** | no pod, no chart ref. |
| `services/workspace-docs-service` | **ABSENT** | no pod, no chart ref. |
| Datastores: postgresql, documentdb, ferretdb, kafka, seaweedfs(master/volume/filer/s3), keycloak, observability(prometheus), grafana, apisix | **POD** | chart `*.enabled: true`; `values-kind.yaml` pins images. Confirmed against the live pod list. |
| Functions runtime (Knative) | **POD** (per-function ksvc) | `fn-primary-multiplier` ksvc; `deploy/kind/control-plane/fn-handlers.mjs` → `function-executor.mjs` (`deployKnativeService`/`invokeKnative`); `FN_RUNTIME_IMAGE=in-falcone-fn-runtime:0.1.0`. |

### What the kind control-plane bundles (`deploy/kind/control-plane`)

`server.mjs` → `b-handlers.mjs` composes `LOCAL_HANDLERS` from: `AUTH_HANDLERS, METRICS_HANDLERS, STORAGE_HANDLERS, MONGO_HANDLERS, PG_HANDLERS, KAFKA_HANDLERS, FN_HANDLERS` + local tenant/workspace/IAM/service-account/saga handlers. Every route uses `localHandler` (self-contained reimplementations) — **no `module:` imports of repo `services/*` source**. Backed by: PG (`tenant-store.mjs`/`saga.mjs`), Keycloak admin (`kc-admin.mjs`), SeaweedFS S3, FerretDB (`mongo-handlers`), Kafka incl. SSE topic stream (`kafka-handlers.mjs::eventsTopicStream`), Knative functions (`fn-handlers`).

### cp-executor feature gates in kind (`apps/control-plane/src/runtime/main.mjs` vs `executor-demo.yaml` env)

| Executor feature | Gate env | kind value | State |
|---|---|---|---|
| Postgres data-plane + DDL | always | PG* set | **ON** |
| Mongo/document data-API | `MONGO_HOST` | `falcone-ferretdb:27017`, `MONGO_BACKEND=ferretdb` | **ON** |
| Events | `KAFKA_BROKERS` | `falcone-kafka:9092` | **ON** |
| Functions | `FN_BACKEND` | unset → local `worker_threads` runner (in-thread; NOT Knative) | **ON (local backend)** |
| JWT verifier | `KEYCLOAK_JWKS_URL` | set | **ON** |
| Realtime (SSE over pgoutput) | `REALTIME_DOCUMENTDB_URL` | **unset** | **OFF** |
| pg realtime (LISTEN/NOTIFY) | (executor superuser) | not exercised; APISIX pg-captures → executor | effectively OFF |
| Flows/workflows/triggers/monitoring | `TEMPORAL_ADDRESS` | **unset** | **OFF** |
| MCP engine | `MCP_ENABLED` | **unset** | **OFF** |
| Fallthrough proxy | `CONTROL_PLANE_UPSTREAM` | `http://falcone-control-plane:8080` | **ON** |

## Capability-backing conclusion (→ `audit/capabilities.md` cap-ids)

| Capability | Live backing in kind? | Backing component |
|---|---|---|
| Tenant lifecycle (`cap-tenant-lifecycle`) | YES | control-plane local handlers + tenant-store + Keycloak |
| Provisioning saga (`cap-tenant-provisioning`) | PARTIAL | bundled saga in control-plane (`saga.mjs`); the multi-applier orchestrator service is ABSENT — only PG/Keycloak/workspace-DB appliers run |
| Auth/console (`cap-auth-console`), IAM (`cap-iam-admin`), token (`cap-token-validation`) | YES | Keycloak pod + control-plane `auth-handlers`/`kc-admin` + cp-executor JWT verifier |
| Postgres data API (`cap-postgres-data-api`) | YES | cp-executor postgres-data + control-plane pg browse handlers |
| Mongo data API (`cap-mongo-data-api`) | YES | cp-executor mongo-data-executor + FerretDB/DocumentDB pods |
| Storage (`cap-storage`, `cap-tenant-storage-context`) | YES | control-plane `storage-handlers` → SeaweedFS S3 pod |
| Events / pub-sub (`cap-events`) | YES | Kafka pod + control-plane `kafka-handlers` + cp-executor events-executor |
| Functions (`cap-functions`) | YES | Knative ksvc + control-plane `fn-handlers` (cp-executor uses an in-thread local runner) |
| Metrics (`cap-metrics`) | PARTIAL | Prometheus + Grafana pods; control-plane/executor `/metrics`; product `metrics-handlers` are read-only views |
| Quotas/plans (`cap-quotas-plans`) | PARTIAL | plan/quota schema seeded in DB; no live quota-enforce pod (executor `FLOW_QUOTA_ENFORCE_URL` unset) |
| **Realtime (`cap-realtime`)** | **NO** | realtime-gateway ABSENT; cp-executor realtime OFF (`REALTIME_DOCUMENTDB_URL` unset). Only Kafka-topic SSE (`eventsTopicStream`) exists — that is events, not the realtime change-stream capability |
| **pg-CDC (`cap-pg-cdc`)** | **NO** | pg-cdc-bridge ABSENT; executor pg-realtime not enabled |
| **mongo-CDC (`cap-mongo-cdc`)** | **NO** | mongo-cdc-bridge ABSENT |
| **Workflows (`cap-*` flows)** | **NO** | workflow-worker + Temporal ABSENT; executor flowExecutor OFF |
| **Webhooks (`cap-webhooks`)** | **NO** | webhook-engine ABSENT, no bundled handler |
| **Scheduling (`cap-scheduling`)** | **NO** | scheduling-engine ABSENT, no bundled handler |
| **Backup/restore (`cap-backup-restore`)** | **NO** | backup-status ABSENT |
| **Secrets (`cap-secrets`)** | **NO** | secret-audit-handler ABSENT; ESO+Vault disabled on kind |
| **Audit (`cap-audit`)** | **NO live writer** | audit/audit-anomaly/secret-audit handlers ABSENT; only read-only audit *views* in control-plane metrics-handlers |
| **MCP** | **NO** | mcp.enabled false; executor MCP engine OFF |

**Campaign-critical (NO live backing component): realtime, pg-CDC, mongo-CDC, workflows/flows, webhooks, scheduling, backup/restore, secrets, audit (write side), MCP.** These will 404 at APISIX (no route/upstream) or fall through to the upstream control-plane which has no handler.

## Test harness table

| Dir | What it tests | Entrypoint | Deploy | Tenant/workspace seeding | Kubeconfig / env |
|---|---|---|---|---|---|
| `tests/blackbox/` | Public-interface contract suite (Node `--test`); pure-function + opt-in real-stack validation | `bash tests/blackbox/run.sh [filter]` | none (in-proc); optional SeaweedFS/FerretDB validation gates | fixtures under `tests/blackbox` | `SEAWEEDFS_VALIDATION=1`, `FERRETDB_VALIDATION=1` (opt-in) |
| `tests/env/` | **Real-stack slice (preferred)** — actions/executor vs live Postgres+Keycloak+Kafka+FerretDB+SeaweedFS+Vault+Temporal+APISIX | `bash tests/env/up.sh` then `bash tests/env/run.sh <test>`; sub-runners `tests/env/executor/run.sh`, `tests/env/keycloak/run.sh` | **docker-compose** (`tests/env/docker-compose.yml`) | `up.sh` provisions Keycloak admin SA, applies migrations, seeds realms `falcone-e2e`; `keycloak-e2e-provision.sh` mints ROPC user + roles; tenants A/B fixed UUIDs in `env.sh` | `source tests/env/env.sh` (DB/MONGO/S3/KC/Kafka/Vault URLs). **No kubeconfig.** Postgres here is `pgvector/pgvector:pg16` (≠ kind PG) |
| `tests/e2e/` | Real-stack E2E (Playwright) — frontend-first user flows + realstack `.mjs` slices | `bash tests/e2e/run.sh [filter]`; per-issue `tests/e2e/run-issue.sh <id>` | **Helm** into ephemeral ns via `tests/e2e/stack.sh` (always torn down) | `stack.sh` seeds k8s secrets; helpers `provisioner.mjs`/`tenant-fixtures.ts` create tenants/workspaces over the API | `./kubeconfig-test-cluster-b.yaml` (auto; override `E2E_KUBECONFIG`); `E2E_NAMESPACE`, `E2E_HELM_*`, `E2E_BASE_URL`, `E2E_FERRETDB`, `E2E_STORAGE_BACKEND`, `E2E_REALTIME_MONGO`, `E2E_KC_TOKEN_URL` |
| `tests/e2e-browser/` | Playwright browser specs (plan-enforcement) | `npx playwright test -c tests/e2e-browser/playwright.config.ts` | reuses a running stack | per-spec | browser base URL env |
| `tests/contracts/` | OpenAPI/event-schema/domain-model contract checks (pure) | via `tests/blackbox/run.sh` / vitest | none | n/a | none |
| `tests/contract/` | Async-operation + event-contract tests (pure + realtime) | vitest/node | none | n/a | none |
| `tests/integration/` | Plan/quota/backup-scope integration; `plan-enforcement/` hits real Keycloak | vitest; `plan-enforcement` uses `helpers/auth.mjs` | docker-compose (tests/env) for KC-backed ones | `seed-backup-scope.mjs` etc. | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, client creds |
| `tests/unit/` | Unit tests (pure) | vitest/node | none | n/a | none |
| `tests/adapters/` | Adapter unit + seaweedfs/ferretdb behaviors | vitest/node | mostly pure; seaweedfs ones hit live S3 when gated | n/a | `S3_*` for live ones |
| `tests/hardening/` | Security hardening suites | `node tests/hardening/run.mjs` | reuses env | n/a | per-suite |
| `tests/saga/`, `tests/workflows/`, `tests/resilience/`, `tests/scope-enforcement/`, `tests/live-audit/`, `tests/reference/` | Saga/workflow/resilience/scope/live-audit/reference specs (mostly pure, some realstack) | vitest/node | none / tests/env | n/a | per-suite |

## Reusable helpers (path → what it does)

### Token minting (Keycloak)
- `tests/e2e/helpers/storage/storage-auth.ts::mintTenantToken` — per-tenant Bearer via OIDC **client_credentials**; token URL `E2E_KC_TOKEN_URL`, per-tenant client creds. Returns `null` when unset (live-gate skip).
- `tests/integration/plan-enforcement/helpers/auth.mjs` — cached `getSuperadminToken()` (client_credentials), `getTenantOwnerToken(tenantId)` (token-exchange/impersonation); token endpoint from `KEYCLOAK_URL`/`KEYCLOAK_REALM`.
- `tests/e2e/realtime/helpers/iam.mjs` — `getAdminAccessToken()` (admin client_credentials), `createTestUser({tenantId,scopes})`, `getToken({username,password,scope})` (**ROPC password grant**), `refreshToken()`. Full per-tenant-user mint + KC admin API.
- `tests/env/e2e-smoke/*.spec.ts` (e.g. `scheduling-http-slice.spec.ts`) — inline ROPC `grant_type=password` mint against `${KEYCLOAK_BASE_URL}/realms/${E2E_REALM}/.../token`, then `Authorization: Bearer` to the APISIX gateway. Copy-paste pattern for gateway calls.
- `tests/env/keycloak-e2e-provision.sh` — provisions realm `falcone-e2e` + public client + ROPC users (`e2e-user`, `e2e-superadmin`) with claims `tenant_id/workspace_id/actor_roles/actor_type/actor_scopes`.

### Gateway / API calls
- `tests/e2e/helpers/api-client.mjs::createApiClient({baseUrl, authToken, correlationId})` — generic JSON client adding `Authorization: Bearer` + correlation id; `createAuditConsumer({brokers,topic,groupId})` for Kafka audit assertions.
- `tests/e2e/helpers/storage/storage-api-client.ts::createStorageApiClient` — `/v1/storage/*` (buckets/objects/usage), tenant identity from token.
- `tests/e2e/helpers/document-store/document-store-api-client.ts::createDocumentApiClient` — `/v1/collections/*` document CRUD/query/search/vector-indexes; identity headers `x-tenant-id`/`x-workspace-id`.
- `tests/e2e/helpers/flows/flows-api-client.ts`, `tests/e2e/helpers/mcp/mcp-api-client.ts` — flows/MCP API clients (note: both capabilities are OFF in kind).
- `tests/env/env.sh` — `APISIX_BASE_URL=http://localhost:9080`, `ACTION_RUNNER_URL=http://localhost:8090` (gateway vs direct shim base URLs).

### Direct datastore connections
- `tests/e2e/realtime/helpers/data-injector.mjs::createDataInjector` — direct **pg `Pool`** (`WS_PG_CONN_STR`) + **`MongoClient`** (`WS_MONGO_CONN_STR`); `insertDoc`/update/delete + pg insert. Bypasses the API to seed data.
- `tests/e2e/realtime/helpers/provisioner.mjs::createProvisioner` — `createTestTenant()`/`createTestWorkspace(tenantId)`/`registerPgDataSource(...)` over `PROVISIONING_API_BASE_URL`; tracks resources for teardown.
- `tests/e2e/realtime/helpers/{kafka-consumer,poller,client,teardown}.mjs` — Kafka consumer, SSE poller, realtime client, teardown.
- Mongo driver seeders: `tests/e2e/realtime/helpers/provisioner.mjs`, `tests/integration/114-backup-scope-deployment-profiles/fixtures/seed-backup-scope.mjs`.
- SeaweedFS / S3: `tests/adapters/seaweedfs-weed-shell-transport.test.mjs`, `tests/env/seaweedfs/seaweedfs-tenant-identities.test.mjs`, `tests/blackbox/seaweedfs-tenant-identities.test.mjs`; S3 creds via `tests/env/env.sh` (`S3_ENDPOINT=http://localhost:58333`, `S3_ACCESS_KEY_ID/…`). Note: tests use `weed shell` / SeaweedFS IAM rather than a generic S3Client helper.

### Tenant/workspace seeding (summary)
- API-driven: `tests/e2e/realtime/helpers/provisioner.mjs`; `tenant-fixtures.ts` under `helpers/{storage,document-store,flows,mcp}` (per-domain two-tenant A/B fixtures).
- Restore/backup fixtures: `tests/e2e/fixtures/restore/{tenant-factory,seed-postgres,seed-mongo,seed-storage,seed-iam,seed-functions}.mjs`.
- Identity constants: `tests/env/env.sh` (`TESTENV_TENANT_A`, `TESTENV_TENANT_B`, `E2E_TENANT_ID`, `E2E_WORKSPACE_ID`).
