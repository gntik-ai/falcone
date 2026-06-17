# Live REST API surface — running Falcone kind deployment

Scope: the **LIVE** system, not `apps/control-plane` source as a spec. Two HTTP backends serve `/v1/*`:

- **control-plane** — `localhost:30500/in-falcone-control-plane:0.6.2`, source `deploy/kind/control-plane/server.mjs`. Loads `routes.mjs` (seed) **merged over** `route-map.runtime.json` via `ROUTE_MAP_FILE=/app/route-map.runtime.json` (values-kind.yaml:127). Self-validates the Keycloak Bearer JWT (JWKS), derives trusted `x-*` identity from claims, strips client-supplied `x-*` (anti-spoofing), dispatches to local handlers (`b-handlers.mjs` + family handlers) or `/repo` action modules.
- **cp-executor** — `localhost:30500/in-falcone-control-plane-executor:0.9.3`, source `apps/control-plane/src/runtime/server.mjs` + `main.mjs`, deployed by `deploy/kind/executor-demo.yaml`. Serves the **data-plane + DDL slice** locally; **proxies everything else** to `CONTROL_PLANE_UPSTREAM=http://falcone-control-plane:8080`. Reached only via the APISIX `*-key` / `*-rt` / `*-keys` routes (API-key or admin-JWT traffic).

Route precedence in `server.mjs` (control-plane): seed `routes.mjs` **wins over** the runtime map on `METHOD path` collision (`loadRoutes`), then most-specific path first.

Auth model (`server.mjs::authenticate`/`authzOk`):
- `public` — no token.
- `authenticated` — any valid Bearer JWT; the **action self-decides** finer authz.
- `tenant_owner` — JWT with tenant_owner/tenant_admin/superadmin/internal actorType or roles.
- `superadmin` — actorType superadmin/internal or roles superadmin/platform_admin.
- Tenant/workspace scoping flows from **verified JWT claims** (`tenant_id`, `workspace_id`) into `callerContext` and the trusted `x-tenant-id`/`x-workspace-id` headers — never from the request body.

---

## 1. Served routes (control-plane backend)

`handler/source` = `deploy/kind/control-plane/<file>::<fn>` for local handlers, or the `/repo` action module from `route-map.runtime.json`. Scoping = which path/claim carries tenant/workspace/project.

### 1a. Console auth (PUBLIC — mint/verify session)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| POST | /v1/auth/login-sessions | auth-handlers::login | cap-auth-console | none (ROPC) | public | Keycloak ROPC; returns session + tokens |
| POST | /v1/auth/signups | auth-handlers::signup | cap-auth-console | none | public | self-service signup |
| POST | /v1/auth/login-sessions/{sessionId}/refresh | auth-handlers::refresh | cap-auth-console | sessionId | public | refresh tokens |
| DELETE | /v1/auth/login-sessions/{sessionId} | auth-handlers::logout | cap-auth-console | sessionId | authenticated | logout |
| GET | /v1/auth/signups/policy | auth-handlers::signupPolicy | cap-auth-console | none | public | signup policy |

### 1b. Tenant lifecycle + users (LOCAL — kc-admin + tenant-store)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| POST | /v1/tenants | b-handlers::createTenant | cap-tenant-lifecycle / cap-tenant-provisioning | body | superadmin | creates realm + registry |
| GET | /v1/tenants | b-handlers::listTenants | cap-tenant-lifecycle | none | superadmin | |
| GET | /v1/tenants/{tenantId} | b-handlers::getTenant | cap-tenant-lifecycle | tenantId (path) | authenticated | |
| DELETE | /v1/tenants/{tenantId} | b-handlers::deleteTenant | cap-tenant-lifecycle | tenantId | superadmin | |
| POST | /v1/tenants/{tenantId}/purge | b-handlers::purgeTenant | cap-tenant-lifecycle | tenantId | superadmin | cascading cleanup |
| GET | /v1/tenants/{tenantId}/environments | b-handlers::listEnvironments | cap-tenant-lifecycle | tenantId | authenticated | |
| POST | /v1/tenants/{tenantId}/users | b-handlers::createTenantUser | cap-iam-admin | tenantId | authenticated | |
| GET | /v1/tenants/{tenantId}/users | b-handlers::listTenantUsers | cap-iam-admin | tenantId | authenticated | |

### 1c. Workspaces (LOCAL)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| POST | /v1/tenants/{tenantId}/workspaces | b-handlers::createWorkspace | cap-workspace-lifecycle | tenantId | authenticated | |
| GET | /v1/tenants/{tenantId}/workspaces | b-handlers::listTenantWorkspaces | cap-workspace-lifecycle | tenantId | authenticated | |
| GET | /v1/workspaces | b-handlers::listWorkspaces | cap-workspace-lifecycle | actor.tenantId | authenticated | |
| GET | /v1/workspaces/{workspaceId} | b-handlers::getWorkspace | cap-workspace-lifecycle | workspaceId | authenticated | |

### 1d. Service accounts + credentials (LOCAL)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| POST | /v1/workspaces/{workspaceId}/service-accounts | b-handlers::createServiceAccount | cap-external-apps-service-accounts | workspaceId | authenticated | |
| GET | /v1/workspaces/{workspaceId}/service-accounts | b-handlers::listServiceAccounts | cap-external-apps-service-accounts | workspaceId | authenticated | |
| GET | /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId} | b-handlers::getServiceAccount | cap-external-apps-service-accounts | workspaceId | authenticated | |
| POST | /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance | b-handlers::issueCredential | cap-external-apps-service-accounts / cap-secrets | workspaceId | authenticated | |
| POST | /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations | b-handlers::rotateCredential | cap-secrets | workspaceId | authenticated | |
| POST | /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations | b-handlers::revokeCredential | cap-secrets | workspaceId | authenticated | |

### 1e. Workspace data plane: DB provisioning + function registry (LOCAL)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| POST | /v1/workspaces/{workspaceId}/database | b-handlers::provisionDatabase | cap-workspace-lifecycle | workspaceId | authenticated | |
| GET | /v1/workspaces/{workspaceId}/database | b-handlers::getDatabase | cap-workspace-lifecycle | workspaceId | authenticated | |
| POST | /v1/workspaces/{workspaceId}/database/credential-rotations | b-handlers::rotateDatabaseCredential | cap-secrets | workspaceId | authenticated | |
| POST | /v1/workspaces/{workspaceId}/databases | b-handlers::provisionDatabaseGeneric | cap-workspace-lifecycle | workspaceId | authenticated | engine-dispatched (pg/mongo) |
| POST | /v1/workspaces/{workspaceId}/functions | b-handlers::registerFunction | cap-functions | workspaceId | authenticated | registry only |
| GET | /v1/workspaces/{workspaceId}/functions | b-handlers::listFunctions | cap-functions | workspaceId | authenticated | |

### 1f. Fine-grained IAM (LOCAL kc-admin; realmId in path)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET/POST | /v1/iam/realms/{realmId}/users | b-handlers::iamListUsers / iamCreateUser | cap-iam-admin | realmId | superadmin | |
| GET/POST | /v1/iam/realms/{realmId}/roles | b-handlers::iamListRoles / iamCreateRole | cap-iam-admin | realmId | superadmin | |
| GET/POST | /v1/iam/realms/{realmId}/groups | b-handlers::iamListGroups / iamCreateGroup | cap-iam-admin | realmId | superadmin | |
| GET | /v1/iam/realms/{realmId}/clients | b-handlers::iamListClients | cap-iam-admin | realmId | superadmin | |
| GET | /v1/iam/realms/{realmId}/users/{userId}/roles | b-handlers::iamListUserRoles | cap-iam-admin | realmId | superadmin | |
| POST/DELETE | /v1/iam/realms/{realmId}/users/{userId}/role-assignments | b-handlers::iamAssignUserRoles / iamRemoveUserRoles | cap-iam-admin | realmId | superadmin | |
| GET | /v1/iam/realms/{realmId}/users/{userId}/groups | b-handlers::iamListUserGroups | cap-iam-admin | realmId | superadmin | |
| PUT/DELETE | /v1/iam/realms/{realmId}/users/{userId}/groups/{groupId} | b-handlers::iamAddUserToGroup / iamRemoveUserFromGroup | cap-iam-admin | realmId | superadmin | |
| GET | /v1/iam/realms/{realmId}/groups/{groupId}/members | b-handlers::iamListGroupMembers | cap-iam-admin | realmId | superadmin | |

### 1g. Console metrics — Quotas + Observability (LOCAL; synthesized from entitlements/consumption)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/metrics/tenants/{tenantId}/quotas | metrics-handlers::quotas | cap-metrics / cap-quotas-plans | tenantId | authenticated | |
| GET | /v1/metrics/tenants/{tenantId}/overview | metrics-handlers::overview | cap-metrics | tenantId | authenticated | |
| GET | /v1/metrics/tenants/{tenantId}/usage | metrics-handlers::usage | cap-metrics | tenantId | authenticated | |
| GET | /v1/metrics/tenants/{tenantId}/series | metrics-handlers::series | cap-metrics | tenantId | authenticated | **empty** (no metrics data plane) |
| GET | /v1/metrics/tenants/{tenantId}/audit-records | metrics-handlers::auditRecords | cap-audit | tenantId | authenticated | **empty** (no audit store) |
| POST | /v1/metrics/tenants/{tenantId}/audit-exports | metrics-handlers::auditExport | cap-audit | tenantId | authenticated | |
| GET | /v1/metrics/workspaces/{workspaceId}/quotas | metrics-handlers::quotas | cap-metrics / cap-quotas-plans | workspaceId | authenticated | |
| GET | /v1/metrics/workspaces/{workspaceId}/overview | metrics-handlers::overview | cap-metrics | workspaceId | authenticated | |
| GET | /v1/metrics/workspaces/{workspaceId}/usage | metrics-handlers::usage | cap-metrics | workspaceId | authenticated | |
| GET | /v1/metrics/workspaces/{workspaceId}/series | metrics-handlers::series | cap-metrics | workspaceId | authenticated | empty |
| GET | /v1/metrics/workspaces/{workspaceId}/audit-records | metrics-handlers::auditRecords | cap-audit | workspaceId | authenticated | empty |
| POST | /v1/metrics/workspaces/{workspaceId}/audit-exports | metrics-handlers::auditExport | cap-audit | workspaceId | authenticated | |

### 1h. PostgreSQL data browser — read-only catalogs (LOCAL pg-handlers)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/postgres/databases | pg-handlers::pgListDatabases | cap-postgres-data-api | actor.tenantId | authenticated | live pg catalogs |
| GET | /v1/postgres/databases/{db}/schemas | pg-handlers::pgListSchemas | cap-postgres-data-api | db | authenticated | |
| GET | /v1/postgres/databases/{db}/schemas/{schema}/tables | pg-handlers::pgListTables | cap-postgres-data-api | db/schema | authenticated | |
| GET | /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns | pg-handlers::pgColumns | cap-postgres-data-api | table | authenticated | |
| GET | …/tables/{table}/indexes | pg-handlers::pgIndexes | cap-postgres-data-api | table | authenticated | |
| GET | …/tables/{table}/policies | pg-handlers::pgPolicies | cap-tenant-isolation | table | authenticated | RLS policies |
| GET | …/tables/{table}/security | pg-handlers::pgSecurity | cap-tenant-isolation | table | authenticated | |
| GET | …/schemas/{schema}/views | pg-handlers::pgViews | cap-postgres-data-api | schema | authenticated | |
| GET | …/schemas/{schema}/materialized-views | pg-handlers::pgMatViews | cap-postgres-data-api | schema | authenticated | |

### 1i. MongoDB document store browser (LOCAL mongo-handlers, real driver / FerretDB)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/mongo/databases | mongo-handlers::mongoListDatabases | cap-mongo-data-api | actor.tenantId | authenticated | |
| GET | /v1/mongo/databases/{db}/collections | mongo-handlers::mongoListCollections | cap-mongo-data-api | db | authenticated | |
| GET | /v1/mongo/databases/{db}/collections/{col} | mongo-handlers::mongoCollectionDetail | cap-mongo-data-api | db/col | authenticated | |
| GET | /v1/mongo/databases/{db}/collections/{col}/indexes | mongo-handlers::mongoIndexes | cap-mongo-data-api | col | authenticated | |
| GET | /v1/mongo/databases/{db}/views | mongo-handlers::mongoViews | cap-mongo-data-api | db | authenticated | |
| GET | /v1/mongo/workspaces/{workspaceId}/data/{db}/collections/{col}/documents | mongo-handlers::mongoDocuments | cap-mongo-data-api | workspaceId | authenticated | document read |

### 1j. Object storage (LOCAL storage-handlers, real S3/SeaweedFS SigV4)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/storage/buckets | storage-handlers::storageListBuckets | cap-storage | actor.tenantId | authenticated | |
| POST | /v1/storage/workspaces/{workspaceId}/buckets | storage-handlers::storageProvisionBucket | cap-storage | workspaceId | authenticated | |
| GET | /v1/storage/workspaces/{workspaceId}/usage | storage-handlers::storageWorkspaceUsage | cap-storage | workspaceId | authenticated | |
| GET | /v1/storage/buckets/{bucketId}/objects | storage-handlers::storageListObjects | cap-storage | bucketId | authenticated | |
| GET | /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata | storage-handlers::storageObjectMetadata | cap-storage | bucketId | authenticated | |
| PUT | /v1/storage/buckets/{bucketId}/objects/{objectKey} | storage-handlers::storagePutObject | cap-storage | bucketId | authenticated | object I/O (#500) |
| GET | /v1/storage/buckets/{bucketId}/objects/{objectKey} | storage-handlers::storageGetObject | cap-storage | bucketId | authenticated | |
| DELETE | /v1/storage/buckets/{bucketId}/objects/{objectKey} | storage-handlers::storageDeleteObject | cap-storage | bucketId | authenticated | |

### 1k. Functions — real execution via k8s Jobs / Knative (LOCAL fn-handlers)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/functions/workspaces/{workspaceId}/inventory | fn-handlers::fnInventory | cap-functions | workspaceId | authenticated | |
| GET | /v1/functions/workspaces/{workspaceId}/actions | fn-handlers::fnListActions | cap-functions | workspaceId | authenticated | |
| POST | /v1/functions/actions | fn-handlers::fnDeploy | cap-functions | body/identity | authenticated | |
| GET | /v1/functions/actions/{actionId} | fn-handlers::fnActionDetail | cap-functions | actionId | authenticated | |
| PUT | /v1/functions/actions/{actionId} | fn-handlers::fnDeploy | cap-functions | actionId | authenticated | |
| POST | /v1/functions/actions/{actionId}/invocations | fn-handlers::fnInvoke | cap-functions | actionId | authenticated | real exec |
| POST | /v1/functions/actions/{actionId}/rollback | fn-handlers::fnRollback | cap-functions | actionId | authenticated | |
| GET | /v1/functions/actions/{actionId}/versions | fn-handlers::fnVersions | cap-functions | actionId | authenticated | |
| GET | /v1/functions/actions/{actionId}/activations | fn-handlers::fnActivations | cap-functions | actionId | authenticated | |
| GET | /v1/functions/actions/{actionId}/activations/{activationId} | fn-handlers::fnActivation | cap-functions | actionId | authenticated | |
| GET | …/activations/{activationId}/logs | fn-handlers::fnActivationLogs | cap-functions | activationId | authenticated | |
| GET | …/activations/{activationId}/result | fn-handlers::fnActivationResult | cap-functions | activationId | authenticated | |

### 1l. Events / Kafka — real kafkajs (LOCAL kafka-handlers)

| METHOD | PATH | handler::fn | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /v1/events/workspaces/{workspaceId}/inventory | kafka-handlers::eventsInventory | cap-events | workspaceId | authenticated | |
| POST | /v1/events/workspaces/{workspaceId}/topics | kafka-handlers::eventsProvisionTopic | cap-events | workspaceId | authenticated | |
| GET | /v1/events/topics/{topicId} | kafka-handlers::eventsTopicDetail | cap-events | topicId | authenticated | |
| GET | /v1/events/topics/{topicId}/access | kafka-handlers::eventsTopicAccess | cap-events | topicId | authenticated | |
| GET | /v1/events/topics/{topicId}/metadata | kafka-handlers::eventsTopicMetadata | cap-events | topicId | authenticated | |
| POST | /v1/events/topics/{topicId}/publish | kafka-handlers::eventsTopicPublish | cap-events | topicId | authenticated | |
| GET | /v1/events/topics/{topicId}/stream | kafka-handlers::eventsTopicStream | cap-events | topicId | authenticated | **SSE** (`stream:true`) |

### 1m. Plans / quotas / entitlements (REPO actions, `/repo/services/provisioning-orchestrator/src/actions`)

Full list from `route-map.runtime.json`. All `provisioning-orchestrator` action modules; capability **cap-quotas-plans** (audit subroutes → cap-audit; scope-enforcement audit → cap-tenant-isolation).

| METHOD | PATH | module::main | scoping | auth | notes |
|---|---|---|---|---|---|
| GET | /v1/plans | plan-list | page/status (query) | superadmin | |
| POST | /v1/plans | plan-create | body | superadmin | event emission no-op (no kafka producer) |
| GET | /v1/plans/change-history | plan-change-history-query | query | superadmin | seed-only route (routes.mjs) |
| GET | /v1/plans/{planIdOrSlug} | plan-get | planIdOrSlug | authenticated | action self-checks (hyphen vs underscore actorType caveat) |
| PUT | /v1/plans/{planId} | plan-update | planId + body | superadmin | |
| POST | /v1/plans/{planId}/lifecycle | plan-lifecycle | planId + body | superadmin | |
| GET | /v1/plans/{planId}/limits | plan-limits-profile-get | planId | superadmin | |
| PUT | /v1/plans/{planId}/limits/{dimensionKey} | plan-limits-set | planId/dimensionKey + body | superadmin | |
| DELETE | /v1/plans/{planId}/limits/{dimensionKey} | plan-limits-remove | planId/dimensionKey | superadmin | |
| POST | /v1/tenants/{tenantId}/plan | plan-assign | tenantId + body | superadmin | |
| GET | /v1/tenants/{tenantId}/plan | plan-assignment-get | tenantId | authenticated | |
| GET | /v1/tenant/plan | plan-assignment-get | actor.tenantId | authenticated | self variant |
| GET | /v1/tenants/{tenantId}/plan/history | plan-assignment-history | tenantId + query | superadmin | |
| GET | /v1/tenants/{tenantId}/plan/history-impact | plan-change-history-query | tenantId + query | superadmin | requireInternal |
| GET | /v1/tenant/plan/limits | plan-limits-tenant-get | actor.tenantId | authenticated | |
| GET | /v1/tenant/plan/effective-entitlements | tenant-effective-entitlements-get | actor.tenantId | authenticated | |
| GET | /v1/tenants/{tenantId}/plan/effective-entitlements | tenant-effective-entitlements-get | tenantId | authenticated | cross-tenant 403 guard |
| GET | /v1/tenant/entitlements | tenant-effective-entitlements-get | actor.tenantId | tenant_owner | seed-only route |
| GET | /v1/plans/{planId}/effective-entitlements | plan-effective-entitlements-get | tenantId (query; ignores planId) | superadmin | UNCERTAIN path/param mismatch |
| GET | /v1/tenant/plan/consumption | tenant-consumption-snapshot-get | actor.tenantId | authenticated | |
| GET | /v1/tenants/{tenantId}/plan/consumption | tenant-consumption-snapshot-get | tenantId | authenticated | cross-tenant 403 guard |
| GET | /v1/tenant/plan/allocation-summary | tenant-workspace-allocation-summary-get | actor.tenantId | authenticated | |
| GET | /v1/tenants/{tenantId}/plan/allocation-summary | tenant-workspace-allocation-summary-get | tenantId | authenticated | cross-tenant 403 guard |
| GET | /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption | workspace-consumption-get | tenantId/workspaceId | authenticated | |
| GET | /v1/workspaces/{workspaceId}/effective-limits | workspace-effective-limits-get | workspaceId + actor.tenantId | authenticated | UNCERTAIN tenantId source |
| GET | /v1/quota-dimensions | quota-dimension-catalog-list | none | superadmin | |
| GET | /v1/tenants/{tenantId}/quota/effective-limits | quota-effective-limits-get | tenantId | authenticated | |
| POST | /v1/tenants/{tenantId}/quota/overrides | quota-override-create | tenantId + body | superadmin | |
| GET | /v1/tenants/{tenantId}/quota/overrides | quota-override-list | tenantId + query | superadmin | |
| PATCH | /v1/tenants/{tenantId}/quota/overrides/{overrideId} | quota-override-modify | overrideId + body | superadmin | |
| DELETE | /v1/tenants/{tenantId}/quota/overrides/{overrideId} | quota-override-revoke | overrideId + body | superadmin | |
| GET | /v1/tenants/{tenantId}/quota/audit | quota-audit-query | tenantId + query | authenticated | cap-audit; tenant-owner forced own |
| POST | /v1/workspace-sub-quotas | workspace-sub-quota-set | body (tenantId/workspaceId) | authenticated (seed: tenant_owner) | |
| GET | /v1/workspace-sub-quotas | workspace-sub-quota-list | query | authenticated (seed: tenant_owner) | |
| DELETE | /v1/workspace-sub-quotas | workspace-sub-quota-remove | query | authenticated | |
| GET | /v1/tenants/{tenantId}/effective-capabilities | tenant-effective-capabilities-get | tenantId | authenticated | |
| GET | /v1/tenant/effective-capabilities | tenant-effective-capabilities-get | actor.tenantId | authenticated | |
| GET | /v1/capability-catalog | capability-catalog-list | query | superadmin | |

### 1n. Privilege domains / scope-enforcement audit / config / backup / async-ops / scheduling (REPO actions)

| METHOD | PATH | module::main | capability | scoping | auth | notes |
|---|---|---|---|---|---|---|
| GET | /api/workspaces/{workspaceId}/privilege-domains | privilege-domain-query | cap-iam-admin | workspaceId + ?tenantId | authenticated | non-`/v1` prefix |
| GET | /api/workspaces/{workspaceId}/privilege-domains/audit | privilege-domain-audit-query | cap-audit | workspaceId + query | authenticated | non-`/v1` prefix |
| GET | /v1/tenants/{tenant_id}/scope-enforcement/audit | scope-enforcement-audit-query | cap-tenant-isolation / cap-audit | tenant_id (admins) / callerContext | authenticated | from/to required |
| GET | /v1/realtime/workspaces/{workspaceId}/pg-captures | realtime/pg-capture-list | cap-pg-cdc | tenant+workspace from headers | authenticated | requires x-tenant-id AND x-workspace-id in JWT |
| GET | /v1/admin/config/format-versions | tenant-config-format-versions | cap-tenant-provisioning | x-tenant-id header | superadmin | scope platform:admin:config:export |
| GET | /v1/admin/tenants/{tenant_id}/config/export/domains | tenant-config-export-domains | cap-tenant-provisioning | tenant_id | superadmin | |
| POST | /v1/admin/tenants/{tenant_id}/config/export | tenant-config-export | cap-tenant-provisioning | tenant_id + body | superadmin | |
| POST | /v1/admin/tenants/{tenant_id}/config/reprovision/preflight | tenant-config-preflight | cap-tenant-provisioning | tenant_id + body | superadmin | |
| POST | /v1/admin/tenants/{tenant_id}/config/reprovision | tenant-config-reprovision | cap-tenant-provisioning | tenant_id + body | superadmin | |
| POST | /v1/admin/tenants/{tenant_id}/config/reprovision/identifier-map | tenant-config-identifier-map | cap-tenant-provisioning | tenant_id + body | superadmin | |
| POST | /v1/admin/tenants/{tenant_id}/config/validate | tenant-config-validate | cap-tenant-provisioning | body | superadmin | no DB |
| POST | /v1/admin/tenants/{tenant_id}/config/migrate | tenant-config-migrate | cap-tenant-provisioning | body | superadmin | no DB |
| GET | /v1/admin/backup/scope | backup-scope-get | cap-backup-restore | ?profile | superadmin | event emission no-op |
| GET | /v1/tenants/{tenantId}/backup/scope | tenant-backup-scope-get | cap-backup-restore | tenantId | authenticated | actorType caveat (only superadmin passes as-is) |
| POST | /v1/async-operation-query | async-operation-query | cap-tenant-provisioning | callerContext + body | authenticated | sub-routes list/detail/logs/result |
| ANY | /v1/scheduling/* | scheduling-engine/actions/scheduling-management | cap-scheduling | tenant+workspace from headers | authenticated | wildcard; internal sub-router (jobs / jobs/{id} / pause / config / summary); requires x-tenant-id AND x-workspace-id |

### Infra / non-`/v1`
- `GET /metrics`, `/metrics/` — Prometheus scrape, **no auth** (both backends; `metrics-registry.mjs::renderMetrics`). cap-metrics.
- `GET /healthz`, `/readyz` — DB ping, no auth (both backends). `GET /` — service banner (control-plane). `OPTIONS *` — CORS preflight 204.

---

## 2. Executor: served LOCALLY vs proxied to control-plane

The cp-executor (`apps/control-plane/src/runtime/server.mjs::buildRoutes`) holds a small regex route table. **The discriminator is purely the route-table regex match** (`routes.find(...)` at server.mjs:720): a match → handled locally; **no match → `proxyRequest` to `CONTROL_PLANE_UPSTREAM`** (set to `http://falcone-control-plane:8080` in `executor-demo.yaml`). Unset upstream → 404. The executor is only reachable for traffic the APISIX `-key`/`-rt`/`-keys` routes steer to it (see §3); all JWT-cookie console traffic goes straight to control-plane and never touches the executor.

**Served LOCALLY by the executor** (data-plane + DDL slice):

| Family | Path regex (under prefix) | Operations | Enabled in live kind? |
|---|---|---|---|
| Postgres data CRUD | `/v1/postgres/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}/rows[...]` | list, insert, bulk/insert, get/patch/delete by-primary-key | YES (registry always wired) |
| Vector search | `…/tables/{t}/search` | knn_search (queryVector/queryText) | YES (embeddingExecutor wired) |
| Postgres DDL | `/v1/postgres/databases/{db}/schemas[...]` | schema/table/column/index/vector-index/policy/security | YES |
| Embedding provider | `/v1/workspaces/{w}/embedding-provider` | PUT/DELETE | YES |
| Embedding mapping | `…/tables/{t}/embedding-mapping` | PUT/GET/DELETE | YES |
| Mongo documents | `/v1/mongo/workspaces/{w}/data/{db}/collections/{c}/documents[...]` | list/insert/get/patch/put/delete | YES (`MONGO_HOST` set → FerretDB) |
| Events (Kafka) | `/v1/events/workspaces/{w}/topics[...]` | list/create/publish/consume | YES (`KAFKA_BROKERS` set) |
| Functions | `/v1/functions/workspaces/{w}/actions[...]` | list/deploy/get/invoke/activations | YES (local worker_threads backend; no FN_BACKEND=off) |
| API keys | `/v1/workspaces/{w}/api-keys[...]` | issue/list/rotate/revoke (admin JWT only) | YES (apiKeyStore wired) |
| Realtime Mongo SSE | `/v1/realtime/workspaces/{w}/data/{db}/collections/{c}/changes` | SSE | **CONDITIONAL** — needs `REALTIME_DOCUMENTDB_URL`. executor-demo.yaml does NOT set it → 501 REALTIME_DISABLED; values-kind control-plane sets it as `optional:true` secret (off unless the secret exists) |
| Realtime PG SSE | `/v1/realtime/workspaces/{w}/data/{db}/schemas/{s}/tables/{t}/changes` | SSE | YES (pgRealtimeExecutor has no env gate; created unconditionally) |
| Flows (Temporal) | `/v1/flows/workspaces/{w}/flows[...]`, `/task-types`, `/triggers/webhooks/{id}`, `/executions/{e}/events` | full CRUD + execution + webhook + monitoring SSE | **DISABLED** — needs `TEMPORAL_ADDRESS` (unset) → routes not registered → fall through to proxy → control-plane 404 (cap-webhooks webhook ingestion also dead) |
| MCP hosting mgmt | `/v1/mcp/workspaces/{w}/servers[...]` | create/curate/publish/approve/tool-calls/audit | **DISABLED** — needs `MCP_ENABLED=true` (unset) → not registered → proxy → 404 |

**Proxied to control-plane** (no local regex match): everything else under the data prefixes — e.g. `/v1/postgres/databases` browse, `/v1/mongo/databases` browse, `/v1/events/workspaces/{w}/inventory`, `/v1/functions/workspaces/{w}/inventory`, all `/v1/plans`, `/v1/tenants/*`, `/v1/metrics/*`, `/v1/storage/*`, `/v1/iam/*`, `/v1/auth/*`. (Storage has **no** executor-local route at all → always proxied / served by control-plane.)

Executor auth precedence (`resolveIdentity`): (1) API key `flc_…` (Authorization ApiKey/Bearer, `apikey`, `x-api-key`, or `?apikey=` for SSE) → tenant/workspace from the verified key; (2) Bearer JWT (jwtVerifier, enabled — `KEYCLOAK_JWKS_URL` set) → claims; (3) gateway-injected `x-tenant-id`/`x-workspace-id` headers — **only** trusted when `GATEWAY_SHARED_SECRET` is set AND `x-gateway-auth` matches; **in executor-demo.yaml `GATEWAY_SHARED_SECRET` is UNSET → dev/test mode: identity headers trusted unconditionally**. Cross-workspace IDOR guard: `credentialWorkspaceId` (from key or workspace-bound JWT) must match the `/workspaces/{w}` path segment (403). API-key mgmt rejects anon/service keys (admin JWT only).

---

## 3. APISIX edge routes actually exposed

Standalone route table `deploy/kind/apisix/apisix.yaml` (applied by `apply-apisix-routes.sh`). Every route carries `cors:{}`. **No `apikey-auth` / `jwt-auth` / `openid-connect` plugin is wired at the edge** — auth is delegated to the upstream (control-plane self-verifies JWT; executor self-verifies key/JWT). Edge selection is by **prefix + priority + `vars`** (presence of `apikey: flc_` header, or `/changes$`, or `/api-keys` path).

| prio | id | URI | methods | vars (selector) | plugins | upstream |
|---|---|---|---|---|---|---|
| 340 | 2016-rt | /v1/realtime/* | GET,OPTIONS | `uri ~~ /changes$` | cors, **proxy-rewrite strip x-tenant/x-workspace/x-auth-subject/x-actor-roles + set x-gateway-auth**, **limit-count 120/60s/429** keyed `$http_apikey$arg_apikey` | **cp-executor** (send/read 3600s) |
| 337 | 2003-keys | /v1/workspaces/* | all | `uri ~~ ^/v1/workspaces/[^/]+/api-keys` | cors, proxy-rewrite strip+x-gateway-auth | **cp-executor** |
| 335 | 2005-key | /v1/postgres/* | all | `apikey ~~ ^flc_` | cors, proxy-rewrite strip+x-gateway-auth, **limit-count 120/60s** keyed `$http_apikey` | **cp-executor** |
| 334 | 2006-key | /v1/mongo/* | all | `apikey ~~ ^flc_` | cors, proxy-rewrite strip+x-gateway-auth, limit-count | **cp-executor** |
| 333 | 2007-key | /v1/events/* | all | `apikey ~~ ^flc_` | cors, proxy-rewrite strip+x-gateway-auth, limit-count | **cp-executor** |
| 332 | 2008-key | /v1/functions/* | all | `apikey ~~ ^flc_` | cors, proxy-rewrite strip+x-gateway-auth, limit-count | **cp-executor** |
| 330 | 3001 | /_native/keycloak/admin/* | all | — | cors | keycloak |
| 300 | 1010 | /health | GET | — | cors | control-plane |
| 239 | 2001 | /v1/platform/* | all | — | cors | control-plane |
| 238 | 2002 | /v1/tenants/* | all | — | cors | control-plane |
| 237 | 2003 | /v1/workspaces/* | all | — | cors | control-plane |
| 236 | 2004 | /v1/auth/* | all | — | cors | control-plane |
| 235 | 2004-iam | /v1/iam/* | all | — | cors | control-plane |
| 235 | 2005 | /v1/postgres/* | all | — (no apikey) | cors | control-plane |
| 234 | 2006 | /v1/mongo/* | all | — | cors | control-plane |
| 233 | 2007 | /v1/events/* | all | — | cors | control-plane |
| 232 | 2008 | /v1/functions/* | all | — | cors | control-plane |
| 231 | 2009 | /v1/storage/* | all | — | cors | control-plane |
| 230 | 2010 | /v1/metrics/* | all | — | cors | control-plane |
| 229 | 2011 | /v1/websockets/* | all | — | cors | control-plane (no upstream handler → 404) |
| 228 | 2012 | /v1/workspaces/{w}/pg-captures/* | all | — | cors | control-plane |
| 227 | 2013 | /v1/tenants/{t}/pg-captures/summary/* | all | — | cors | control-plane |
| 226 | 2014 | /v1/realtime/workspaces/{w}/mongo-captures/* | all | — | cors | control-plane |
| 225 | 2015 | /v1/realtime/tenants/{t}/mongo-captures/summary/* | all | — | cors | control-plane |
| 100 | 1001 | /control-plane/* | — | — | — | control-plane |
| 90 | 1002 | /auth/* | — | — | proxy-rewrite strip `/auth` | keycloak |
| 80 | 1003 | /realtime/* | — | — | — | control-plane |
| 50 | 5000 | /v1/* | all | — | cors | control-plane (catch-all) |
| 10 | 1004 | /* | — | — | — | web-console SPA |

**Edge security note:** `x-gateway-auth: "${{GATEWAY_SHARED_SECRET}}"` is injected on executor-bound routes, but the executor's `executor-demo.yaml` does NOT set `GATEWAY_SHARED_SECRET` → the executor runs in dev/test mode (gateway trust signal not enforced; identity headers trusted unconditionally). The header-strip (removing client `x-tenant-id`/`x-workspace-id`/`x-auth-subject`/`x-actor-roles`) IS applied, so the primary header-spoof path is closed regardless. Per-key rate limiting (120 req/60s → 429) is the only quota enforced at the edge.

---

## 4. Capabilities with NO corresponding live route (expected-but-absent gaps)

Capability inventory from `audit/capabilities.md` (28 cap-ids). "Live route" = reachable through the running control-plane or executor (with the live env wiring above).

| cap-id | Live route? | Evidence |
|---|---|---|
| cap-auth-console | YES | §1a `/v1/auth/*` |
| cap-tenant-lifecycle | YES | §1b `/v1/tenants/*` |
| cap-tenant-provisioning | YES | §1n `/v1/admin/.../config/*`, `/v1/async-operation-query` |
| cap-tenant-storage-context | PARTIAL | no dedicated route; expressed via storage/DB workspace scoping |
| cap-workspace-lifecycle | YES | §1c, §1e |
| cap-workspace-api-surface | YES | service-accounts + api-keys (executor) |
| cap-iam-admin | YES | §1f `/v1/iam/*`, `/api/workspaces/{w}/privilege-domains` |
| cap-token-validation | YES | enforced in server.mjs `authenticate` (JWKS) + executor jwtVerifier |
| cap-external-apps-service-accounts | YES | §1d + executor api-keys |
| cap-tenant-isolation | YES | RLS + `/v1/.../scope-enforcement/audit`, pg policies/security browse |
| cap-context-propagation | YES | callerContext/x-* propagation (cross-cutting, not a standalone route) |
| cap-postgres-data-api | YES | executor `/v1/postgres/.../rows`, DDL; browse via control-plane |
| **cap-pg-cdc** | YES | `/v1/realtime/workspaces/{w}/pg-captures` (control-plane) + executor PG-change SSE; APISIX 2012/2013 |
| cap-mongo-data-api | YES | §1i + executor `/v1/mongo/.../documents` |
| **cap-mongo-cdc** | **ABSENT (live)** | executor Mongo-change SSE needs `REALTIME_DOCUMENTDB_URL`; UNSET in executor-demo.yaml → 501 REALTIME_DISABLED. APISIX 2014/2015 forward to control-plane but no mongo-capture handler is registered there → effectively dead |
| cap-storage | YES | §1j `/v1/storage/*` |
| **cap-realtime** | **PARTIAL/ABSENT** | edge SSE route 2016-rt wired to executor; PG-table SSE works, but **Mongo-collection SSE off** (as cap-mongo-cdc). `/v1/websockets/*` (APISIX 2011) has **no upstream handler** → 404 |
| cap-events | YES | §1l + executor events |
| cap-functions | YES | §1k + executor functions |
| **cap-webhooks** | **ABSENT (live)** | only inbound webhook trigger is the flows `/triggers/webhooks/{id}` route, registered ONLY with `flowExecutor` (`TEMPORAL_ADDRESS` UNSET) → not registered → proxy → 404. No other webhook route exists |
| **cap-scheduling** | PRESENT but UNVERIFIED | `ANY /v1/scheduling/*` → scheduling-engine action is in the runtime map; requires `x-tenant-id`+`x-workspace-id` and the scheduling tables/config. No APISIX-specific `/v1/scheduling/*` route → reaches control-plane only via the `/v1/*` catch-all (5000). Functional state depends on DB schema presence |
| cap-backup-restore | PARTIAL | read-only scope routes only (`/v1/admin/backup/scope`, `/v1/tenants/{t}/backup/scope`); **no backup execute/restore route** live |
| **cap-secrets** | PARTIAL | credential issue/rotate/revoke routes exist (§1d); no standalone secrets-vault CRUD route |
| cap-quotas-plans | YES | §1m (extensive) |
| cap-audit | PARTIAL | audit *query* routes exist (`/quota/audit`, `/scope-enforcement/audit`, privilege-domains/audit, metrics audit-records) but metrics audit-records returns **empty** (no audit store deployed) |
| cap-metrics | YES (degraded) | §1g console metrics + `/metrics` Prometheus scrape; **series/audit-records empty** (no metrics/audit data plane) |
| cap-gateway | YES | APISIX route table itself (§3) |
| cap-workspace-docs | N/A | docs/OpenAPI capability — no runtime route (not a data surface) |
| **MCP hosting** (no cap-id; proposed feature) | **ABSENT (live)** | executor `/v1/mcp/*` registered only with `MCP_ENABLED=true` (UNSET) → not registered → proxy → 404 |
| **Workflows / flows** (maps to cap-webhooks/scheduling triggers; proposed) | **ABSENT (live)** | all `/v1/flows/*` need `TEMPORAL_ADDRESS` (UNSET) → 501 FLOWS_DISABLED / proxy 404 |

**Summary of expected-but-absent in the live deploy:** MCP hosting, Temporal flows/workflows (incl. flow webhook ingestion → cap-webhooks), Mongo CDC / Mongo realtime SSE, WebSockets (`/v1/websockets/*` no handler), backup *execute/restore*. Degraded-but-present: metrics time-series + audit records (empty), scheduling (depends on DB schema), secrets (only credential lifecycle, no vault CRUD).
