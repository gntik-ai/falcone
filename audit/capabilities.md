# Capabilities — Falcone BaaS (source-derived)

> All items anchored to code evidence (`path::symbol` or `file:line`). Documentation excluded per golden rule.
> Generated: 2026-06-08

---

## Domain A — Tenant Lifecycle & Management

### cap-tenant-lifecycle
**Name:** Tenant lifecycle management
**Summary:** Create, read, update, soft-delete, suspend, and purge tenants; state machine governs allowed transitions (draft → provisioning → active → suspended → soft_deleted). Includes governance dashboard, resource inventory, and functional configuration export.
**Owning services:** control-plane (orchestration surface), provisioning-orchestrator (saga execution)
**Public surface:** `GET/POST/PATCH/DELETE /v1/tenants/*`, `GET/POST/PATCH /v1/admin/tenants/*`
**Evidence:**
- `apps/control-plane/src/tenant-management.mjs::evaluateTenantLifecycleMutation` — previews state machine transitions with dual-confirmation guard (`hasElevatedAccess`, `hasSecondConfirmation`)
- `apps/control-plane/src/tenant-management.mjs::buildTenantPurgeRequestDraft` — builds purge request requiring `approvalTicket` + `confirmationText`
- `services/internal-contracts/src/domain-model.json` — entity states: draft, provisioning, active, suspended, soft_deleted; `<prefix>_<ulid>` IDs (`ten_*`)
- `services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation` (re-export) — canonical lifecycle machine
- `services/gateway-config/base/public-api-routing.yaml` — `tenants` family, `tenantBinding: required`, bearer_oidc
**Confidence:** high

### cap-tenant-provisioning
**Name:** Tenant provisioning saga
**Summary:** Async saga orchestrating creation/deletion of tenant resources across all adapters (IAM realm, Kafka namespace, Postgres schema, MongoDB, storage namespace, OpenWhisk namespace). Preflight validation → applier per domain → rollback on failure.
**Owning services:** provisioning-orchestrator
**Public surface:** Async operation state changes; `GET /v1/admin/operations` (async operation query)
**Evidence:**
- `services/provisioning-orchestrator/src/appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs` — one applier per technology domain, all accept `tenantId`
- `services/provisioning-orchestrator/src/authorization-context.mjs::provisioningAuthorizationContextProjection` — enforces propagation target for provisioning requests
- `services/internal-contracts/src/index.mjs::asyncOperationStateChangedSchema` — async op lifecycle events
- `services/internal-contracts/src/saga-contract.json` — saga contract
**Confidence:** high

### cap-tenant-storage-context
**Name:** Tenant storage namespace & credential management
**Summary:** Derives a deterministic tenant-scoped object-storage namespace from `tenantId + slug`; checks plan capability (`data.storage.bucket`); manages credential lifecycle (issue, rotate, revoke) for the storage namespace; cascades revocation on tenant suspend/delete.
**Owning services:** adapters (storage-tenant-context)
**Public surface:** `GET /v1/admin/tenants/{tenantId}/storage/context`, `POST /v1/admin/tenants/{tenantId}/storage/context/rotate-credential`
**Evidence:**
- `services/adapters/src/storage-tenant-context.mjs::deriveTenantStorageNamespace` — `tctx-{slug}-{sha256(tenantId):12}`
- `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageQuotaAssignment` — checks `STORAGE_CAPABILITY_KEY = 'data.storage.bucket'` via plan resolution
- `services/adapters/src/storage-tenant-context.mjs::rotateTenantStorageContextCredential` — increments credential version, updates `secretRef`
- `services/adapters/src/storage-tenant-context.mjs::TENANT_STORAGE_CONTEXT_STATES` — draft, provisioning, active, suspended, soft_deleted
**Confidence:** high

---

## Domain B — Workspace Management

### cap-workspace-lifecycle
**Name:** Workspace lifecycle management (tenancy-relevant)
**Summary:** Create, read, update, suspend, and delete workspaces within a tenant; state machine mirrors tenant lifecycle. Workspace has own slug, environment, IAM boundary, and membership. Resource inheritance resolves shared vs. specialized resources at clone time.
**Owning services:** control-plane (workspace-management)
**Public surface:** `GET/POST/PATCH/DELETE /v1/workspaces/*`, `GET/POST/PATCH /v1/admin/workspaces/*`
**Evidence:**
- `apps/control-plane/src/workspace-management.mjs::workspaceLifecycleStateMachine` — `getBusinessStateMachine('workspace_lifecycle')`
- `apps/control-plane/src/workspace-management.mjs::buildWorkspaceCloneDraft` — clone with `clonePolicy` (includeApplications, includeServiceAccounts, includeManagedResourceBindings, resetCredentialReferences, reuseTenantLogicalResources)
- `apps/control-plane/src/workspace-management.mjs::resolveWorkspaceResourceInheritance` — classifies shared vs. specialized resources
- `services/gateway-config/base/public-api-routing.yaml` — `workspaces` family, `tenantBinding: required`, `workspaceBinding: optional`
**Confidence:** high

### cap-workspace-api-surface
**Name:** Workspace API surface resolution
**Summary:** Resolves environment-scoped endpoint URLs (control-api, console, identity/Keycloak, realtime) for a workspace; supports optional workspace-subdomain deployment topology.
**Owning services:** internal-contracts (via adapters)
**Public surface:** `GET /v1/workspaces/{workspaceId}/surface` (operationId: `resolveWorkspaceApiSurface`)
**Evidence:**
- `services/internal-contracts/src/index.mjs::resolveWorkspaceApiSurface` — builds `controlApiBaseUrl`, `realtimeBaseUrl`, `identityBaseUrl` per environment profile
- `services/internal-contracts/src/index.mjs::getWorkspaceApplicationBaseUrl` — optional subdomain pattern `{slug}.apps.{env}.in-falcone.example.com`
- `services/internal-contracts/src/deployment-topology.json` — `environment_profiles`, `optional_workspace_subdomain`
**Confidence:** high

---

## Domain C — Authentication & IAM

### cap-auth-console
**Name:** Console authentication
**Summary:** Login sessions (OIDC delegated), signup flow with pending-activation state, password recovery, and status views (login, signup, pending_activation, account_suspended, credentials_expired, password_recovery).
**Owning services:** control-plane (console-auth)
**Public surface:** `POST /v1/auth/login`, `POST /v1/auth/signup`, `POST /v1/auth/password-recovery`, `GET /v1/auth/access-checks`
**Evidence:**
- `apps/control-plane/src/console-auth.mjs::CONSOLE_AUTH_STATUS_VIEWS` — `['login','signup','pending_activation','account_suspended','credentials_expired','password_recovery']`
- `apps/control-plane/src/console-auth.mjs::summarizeConsoleAuthSurface` — public vs. protected route split
- `services/gateway-config/base/public-api-routing.yaml` — `auth` family, `authMode: delegated_oidc`
**Confidence:** high

### cap-iam-admin
**Name:** IAM realm/client/role/scope/user administration (tenancy-relevant)
**Summary:** Full CRUD on Keycloak resources (realm, client, role, scope, user) scoped per tenant. Reserved realm IDs (`master`, `in-falcone-platform`) and role names blocked. Credential reset, activate/deactivate. Gated by `identity.sso.oidc` plan capability.
**Owning services:** control-plane (iam-admin), adapters (keycloak-admin)
**Public surface:** `GET/POST/PUT/DELETE /v1/admin/iam/{realm,client,role,scope,user}/*`
**Evidence:**
- `services/adapters/src/keycloak-admin.mjs::IAM_ADMIN_RESOURCE_KINDS` — `['realm','client','role','scope','user']`
- `services/adapters/src/keycloak-admin.mjs::RESERVED_REALM_IDS` — `['master','in-falcone-platform']`
- `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` — 14 platform/tenant/workspace roles blocked from mutation
- `services/adapters/src/keycloak-admin.mjs::IAM_ADMIN_ACTIONS` — list, get, create, update, delete, activate, deactivate, reset_credentials
- `services/gateway-config/base/public-api-routing.yaml` — `iam` family, `planCapabilityAnyOf: [identity.sso.oidc]`
**Confidence:** high

### cap-token-validation
**Name:** JWT token validation & introspection (tenancy-relevant)
**Summary:** Validates Bearer JWTs via JWKS (cached, refresh on unknown `kid`); falls back to Keycloak introspection; normalizes `tenant_id`, `scopes`, `authorizedWorkspaces` claims; 5 s clock tolerance; rejects expired/revoked tokens.
**Owning services:** realtime-gateway (token-validator)
**Public surface:** Internal middleware — consumed by `SessionManager::createSession`
**Evidence:**
- `services/realtime-gateway/src/auth/token-validator.mjs::createTokenValidator` — JWKS fetch with LRU cache + `forceRefresh` on ERR_JWKS_NO_MATCHING_KEY → introspection fallback
- `services/realtime-gateway/src/auth/token-validator.mjs::normalizeClaims` — extracts `sub`, `tenant_id`, `scopes`, `authorizedWorkspaces`, `exp`, `jti`
- `services/backup-status/src/api/backup-status.auth.js::validateToken` — parallel implementation with jose + jwks-rsa; TEST_MODE blocked in production
**Confidence:** high

### cap-external-apps-service-accounts
**Name:** External applications & service accounts (OAuth2 clients / API keys)
**Summary:** Provisions OAuth2 clients (OIDC/SAML) and service accounts per workspace; validates redirect URIs (HTTPS-only, no localhost outside dev), enforces plan-level application count limits, manages credential lifecycle.
**Owning services:** control-plane (external-application-iam)
**Public surface:** `GET/POST/PUT/DELETE /v1/workspaces/{workspaceId}/applications*`, `/v1/workspaces/{workspaceId}/service-accounts*`
**Evidence:**
- `apps/control-plane/src/external-application-iam.mjs::isLikelyHttpsUri` — HTTPS required; `allowHttpLocalhost` only for dev
- `apps/control-plane/src/external-application-iam.mjs::getLimitValue` — reads `max_applications` from plan limits catalog
- `services/internal-contracts/src/index.mjs::listExternalApplicationSupportedFlows` — `external_application_supported_flows` catalog
- `services/internal-contracts/src/index.mjs::listExternalApplicationPlanLimits` — per-plan application count caps
**Confidence:** high

---

## Domain D — Tenant Isolation & Context Propagation

### cap-tenant-isolation
**Name:** Tenant isolation enforcement (tenancy-relevant)
**Summary:** Every data path scoped by `(tenant_id, workspace_id)`: RLS on shared Postgres tables, Kafka topics namespaced by `tenantId.workspaceId`, realtime session guard, webhook subscription index, scheduling tables, CDC audit log — all prevent cross-tenant data access.
**Owning services:** all data-layer services
**Public surface:** Enforcement surface — not directly callable
**Evidence:**
- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17` — `idx_ws_tenant_workspace ON webhook_subscriptions (tenant_id, workspace_id)`
- `services/scheduling-engine/migrations/001-scheduling-tables.sql:35` — `idx_sj_tenant_workspace ON scheduled_jobs (tenant_id, workspace_id)`
- `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs::guardEvent` — `event.tenantId === session.tenantId && event.workspaceId === session.workspaceId`
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` — `${tenantId}.${workspaceId}.pg-changes` — tenant/workspace never replaceable
- `services/mongo-cdc-bridge/src/index.mjs:30` — audit INSERT includes `tenant_id`, `workspace_id`, `actor_identity`
- `services/internal-contracts/src/authorization-model.json` — `cross_tenant_violation` error class in security_context and authorization_decision contracts
**Confidence:** high

### cap-context-propagation
**Name:** Tenant context propagation through gateway (tenancy-relevant)
**Summary:** Gateway propagates `X-Tenant-Id`, `X-Workspace-Id`, `X-Plan-Id`, `X-Auth-Scopes`, `X-Actor-Roles` to all upstreams; rejects spoofed context headers; scheduling engine reads identity from trusted claim headers.
**Owning services:** gateway-config
**Public surface:** Gateway middleware — not directly callable
**Evidence:**
- `services/gateway-config/base/public-api-routing.yaml` — `propagatedHeaders: [X-Auth-Subject, X-Actor-Username, X-Tenant-Id, X-Workspace-Id, X-Plan-Id, X-Auth-Scopes, X-Actor-Roles]`, `rejectSpoofedContextHeaders: true` in all validation profiles
- `services/gateway-config/base/public-api-routing.yaml` — `internalRequestMode: validated_attestation`, required headers: `X-Gateway-Managed-Route`, `X-Correlation-Id`, `X-Internal-Request-Mode`
**Confidence:** high

---

## Domain E — PostgreSQL Data API

### cap-postgres-data-api
**Name:** PostgreSQL managed database API
**Summary:** Provision and manage PostgreSQL databases, tables, roles, RLS policies, grants, extensions, and schemas within a workspace. Plan-gated (`data.postgresql.shared` or `data.postgresql.dedicated`). Admin SQL execution gated by additional plan flag. WAL CDC captures routed to Kafka.
**Owning services:** control-plane (postgres-admin, postgres-data-api), adapters (postgresql-data-api, postgresql-admin), pg-cdc-bridge
**Public surface:** `GET/POST/PUT/DELETE /v1/postgres/*`; capability gates: `/v1/workspaces/*/sql*`, `/v1/workspaces/*/admin/sql*`
**Evidence:**
- `apps/control-plane/src/postgres-admin.mjs::POSTGRES_ADMIN_RESOURCE_KINDS` (via `postgresql-admin.mjs`) — resource surface: databases, tables, roles, policies, grants, extensions
- `apps/control-plane/src/postgres-admin.mjs::getPostgresCompatibilitySummary` — `adminSqlEnabled` flag per plan; `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES` enforced
- `services/gateway-config/base/public-api-routing.yaml` — `postgres` family, `planCapabilityAnyOf: [data.postgresql.shared, data.postgresql.dedicated]`
- `services/gateway-config/routes/capability-gated-routes.yaml` — `sql_admin_api` capability gates `/v1/workspaces/*/sql*`
- `services/pg-cdc-bridge/src/WalListenerManager.mjs::start` — reads `pg_capture_configs WHERE status='active'`, one WAL listener per `data_source_ref`+`tenant_id`
**Confidence:** high

### cap-pg-cdc
**Name:** PostgreSQL change-data-capture (CDC) to Kafka
**Summary:** Listens to Postgres WAL replication slot per active capture config; decodes row change events; routes through filter; publishes to `{prefix}.{tenantId}.{workspaceId}.pg-changes` Kafka topic with per-workspace rate limiting; records audit in `pg_capture_audit_log`.
**Owning services:** pg-cdc-bridge, control-plane (pg-captures API)
**Public surface:** `GET/POST/DELETE /v1/workspaces/{workspaceId}/pg-captures`, `GET /v1/tenants/{tenantId}/pg-captures/summary`; gated by `data.openwhisk.actions`
**Evidence:**
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` — enforces `tenantId.workspaceId.pg-changes` structure; namespace prefix optional but validated
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` — per-workspace rate window (`PG_CDC_MAX_EVENTS_PER_SECOND`, default 1000)
- `services/pg-cdc-bridge/src/WalListenerManager.mjs` — `CaptureConfigCache`, `WalEventDecoder`, `RouteFilter`, exponential backoff reconnect
- `services/gateway-config/base/public-api-routing.yaml` — `pg-captures` family, `planCapabilityAnyOf: [data.openwhisk.actions]`
**Confidence:** high

---

## Domain F — MongoDB Data API

### cap-mongo-data-api
**Name:** MongoDB managed database API
**Summary:** Provision and manage MongoDB databases, collections, indexes, and access within a workspace. CDC change streams captured and forwarded to Kafka with tenant-scoped audit.
**Owning services:** control-plane (mongo-admin, mongo-data-api), adapters (mongodb-admin, mongodb-data-api), mongo-cdc-bridge
**Public surface:** `GET/POST/PUT/DELETE /v1/mongo/*`
**Evidence:**
- `apps/control-plane/src/mongo-admin.mjs::MONGO_ADMIN_RESOURCE_KINDS` (via `mongodb-admin.mjs`) — admin surface
- `services/mongo-cdc-bridge/src/index.mjs::auditCallback` — `INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, after_state)`
- `services/gateway-config/base/public-api-routing.yaml` — `mongo` family, `tenantBinding: required`, `workspaceBinding: required`
**Confidence:** high

### cap-mongo-cdc
**Name:** MongoDB change-data-capture (CDC) to Kafka
**Summary:** Manages MongoDB change stream per active capture config; stores resume tokens for durability; publishes to tenant-workspace-scoped Kafka topic; status-updates capture config on error; records audit events.
**Owning services:** mongo-cdc-bridge, control-plane (mongo-captures API)
**Public surface:** `GET/POST/DELETE /v1/realtime/workspaces/{workspaceId}/mongo-captures`, `GET /v1/realtime/tenants/{tenantId}/mongo-captures/summary`
**Evidence:**
- `services/mongo-cdc-bridge/src/index.mjs` — `ChangeStreamManager`, `ResumeTokenStore`, `MongoCaptureConfigCache`; `assertValidTopicNamespace` validates prefix
- `services/mongo-cdc-bridge/src/index.mjs:29` — `UPDATE mongo_capture_configs SET status=$2, last_error=$3` on error
- `services/gateway-config/base/public-api-routing.yaml` — `mongo-captures` family, `planCapabilityAnyOf: [data.openwhisk.actions]`
**Confidence:** high

---

## Domain G — Object Storage API

### cap-storage
**Name:** Object storage (bucket & object) API (tenancy-relevant)
**Summary:** Bucket CRUD scoped to tenant storage namespace; object upload/download/delete; multipart uploads; presigned URLs; access policies; event notifications; import/export with manifest; storage usage reporting at bucket/workspace/tenant/cross-tenant scope; programmatic credentials (issue, rotate, revoke); plan-gated by `data.storage.bucket`.
**Owning services:** control-plane (storage-admin), adapters (storage-*)
**Public surface:** `GET/POST/PUT/DELETE /v1/storage/*`
**Evidence:**
- `apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes` — aggregates bucket, object, credential, usage, import-export, and audit routes
- `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageContextRecord` — `namespaceBindingMode: 'tenant_isolated'`; `bucketProvisioningAllowed` requires active context + eligible provider
- `services/adapters/src/storage-tenant-context.mjs::previewWorkspaceStorageBootstrap` — workspace bucket bootstrap gated on tenant storage context being active
- `apps/control-plane/src/storage-admin.mjs::previewStorageExportManifest` / `previewStorageImportResult` — import/export with operation limit check
- `services/gateway-config/base/public-api-routing.yaml` — `storage` family, `planCapabilityAnyOf: [data.storage.bucket]`
**Confidence:** high

---

## Domain H — Realtime / WebSocket Subscriptions

### cap-realtime
**Name:** Realtime WebSocket subscriptions (tenancy-relevant)
**Summary:** WebSocket endpoint for event subscriptions; JWT validated on connect; scope checked against `realtime_scope_channel_mappings` (tenant+workspace-scoped); session stored in Postgres; periodic token re-validation with revocation detection; tenant-workspace isolation enforced on publish; filter expressions with complexity guard.
**Owning services:** realtime-gateway
**Public surface:** `wss://{host}/v1/websockets`; capability-gated: `realtime` capability
**Evidence:**
- `services/realtime-gateway/src/auth/session-manager.mjs::createSession` — validates token, checks scopes, inserts `realtime_sessions` row with `(tenant_id, workspace_id, actor_identity)`
- `services/realtime-gateway/src/auth/session-manager.mjs::startPolling` — periodic `introspectTokenFn` + `checkScopesFn`; suspends session on revocation
- `services/realtime-gateway/src/auth/scope-checker.mjs::createScopeChecker` — loads `realtime_scope_channel_mappings` scoped `(tenantId, workspaceId)`; falls back to `realtime:read` if no mappings
- `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs::guardEvent` — `event.tenantId === session.tenantId && event.workspaceId === session.workspaceId`
- `services/realtime-gateway/src/filters/filter-evaluator.mjs::evaluateFilter` — predicate evaluation (eq, neq, contains) on event fields
- `services/gateway-config/routes/capability-gated-routes.yaml` — `realtime` capability gates `/v1/workspaces/*/realtime*` and `GET /v1/events/subscribe`
**Confidence:** high

---

## Domain I — Events / Pub-Sub (Kafka)

### cap-events
**Name:** Kafka topic management & event pub-sub (tenancy-relevant)
**Summary:** Create/delete/list Kafka topics scoped to workspace; topic ACL management; publish events (CloudEvents supported); stream events (SSE/WebSocket); event bridge integrations; Kafka function triggers; workspace event dashboard. Plan-gated by `data.kafka.topics`.
**Owning services:** control-plane (events-admin), event-gateway, adapters (kafka-admin)
**Public surface:** `GET/POST/DELETE /v1/events/topics*`, `POST /v1/events/publish`, `GET /v1/events/subscribe`
**Evidence:**
- `apps/control-plane/src/events-admin.mjs::KAFKA_ADMIN_RESOURCE_KINDS` — topic, topic_acl, inventory, event_bridge
- `apps/control-plane/src/events-admin.mjs::summarizeEventsAdminSurface` — runtime_publish, runtime_stream, runtime_websocket, function_kafka_trigger surfaces
- `services/gateway-config/base/public-api-routing.yaml` — `events` family, `planCapabilityAnyOf: [data.kafka.topics]`; request validation accepts `application/cloudevents+json`
- `services/gateway-config/base/public-api-routing.yaml` — `websockets` family, `planCapabilityAnyOf: [data.kafka.topics]`
**Confidence:** high

---

## Domain J — Functions / Serverless

### cap-functions
**Name:** Serverless functions (OpenWhisk) (tenancy-relevant)
**Summary:** CRUD for actions, packages, triggers (cron, Kafka, storage), rules, and web-action HTTP exposure; invocation with sync/async response modes; activation records (list, get, logs, result); function versioning (immutable) + rollback; import/export of function definitions; workspace secrets (write-only values, never returned); quota enforcement (function_count, invocation_count, compute_time_ms, memory_mb). Plan-gated by `data.openwhisk.actions`; public invocation additionally gated by `functions_public` capability.
**Owning services:** control-plane (functions-admin, functions-import-export, functions-audit), adapters (openwhisk-admin), provisioning-orchestrator (functions-applier)
**Public surface:** `GET/POST/PUT/DELETE /v1/functions/*`; `POST /v1/functions/*/invoke`; `GET/POST /v1/workspaces/*/functions/public*`
**Evidence:**
- `apps/control-plane/src/functions-admin.mjs::SUPPORTED_FUNCTION_SOURCE_KINDS` / `SUPPORTED_FUNCTION_TRIGGER_KINDS` / `SUPPORTED_FUNCTION_RUNTIMES`
- `apps/control-plane/src/functions-admin.mjs::getOpenWhiskCompatibilitySummary` — `workspaceSecretsSupported: true`, `secretGovernance.valueDisclosure: 'never_returned'`
- `apps/control-plane/src/functions-admin.mjs::summarizeFunctionsAdminSurface` — invocation, activation, version, rollback, http_exposure, storage_trigger, cron_trigger, workspace_secret surfaces
- `services/gateway-config/routes/capability-gated-routes.yaml` — `functions_public` capability gates `POST /v1/functions/*/invoke` and `/v1/workspaces/*/functions/public*`
- `services/gateway-config/base/public-api-routing.yaml` — `functions` family, `planCapabilityAnyOf: [data.openwhisk.actions]`
**Confidence:** high

---

## Domain K — Webhooks

### cap-webhooks
**Name:** Webhook subscriptions & delivery (tenancy-relevant)
**Summary:** Create/update/delete webhook subscriptions with HTTPS-only target URL; SSRF guard validates IP literals (numeric encoding, IPv4-mapped IPv6, link-local, ULA) and resolves DNS to check all resolved IPs; signed payloads with rotating secrets; delivery with retries; subscription states: active, paused, disabled, deleted; auto-disable after `max_consecutive_failures`. Plan-gated by `webhooks` capability.
**Owning services:** webhook-engine
**Public surface:** `GET/POST/PUT/DELETE /v1/workspaces/{workspaceId}/webhooks*`
**Evidence:**
- `services/webhook-engine/src/webhook-subscription.mjs::normalizeNumericIPv4` — handles decimal, octal (0-prefix), hex (0x-prefix), 1–4 part inet_aton encoding
- `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` — blocks 0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, ::1, ::, fc00::/7, fe80::/10; IPv4-mapped IPv6 (::ffff:*) checked
- `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput` — async DNS resolution; all A/AAAA addresses checked; fail-closed on resolution failure
- `services/webhook-engine/src/webhook-subscription.mjs::buildSubscriptionRecord` — stores `tenant_id`, `workspace_id`, `created_by`
- `services/webhook-engine/migrations/001-webhook-subscriptions.sql` — `webhook_subscriptions (tenant_id, workspace_id)`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts`
- `services/gateway-config/routes/capability-gated-routes.yaml` — `webhooks` capability gates `/v1/workspaces/*/webhooks*`
**Confidence:** high

---

## Domain L — Scheduling / Cron

### cap-scheduling
**Name:** Cron job scheduling (tenancy-relevant)
**Summary:** Create/update/pause/delete scheduled jobs with cron expressions targeting OpenWhisk actions; quota enforcement (max active jobs, min interval); consecutive-failure tracking with auto-erroring; per-workspace + per-tenant configuration; execution audit records. Plan-gated by scheduling enablement (`SCHEDULING_ENABLED_BY_DEFAULT`).
**Owning services:** scheduling-engine
**Public surface:** `GET/POST/PUT/DELETE /v1/workspaces/{workspaceId}/schedules/*` (⚠ exact HTTP routes not code-verified in gateway config; inferred from OpenWhisk action names and DB schema)
**Evidence:**
- `services/scheduling-engine/src/job-model.mjs::buildJobRecord` — stores `tenant_id`, `workspace_id`, `cron_expression`, `target_action`, `consecutive_failure_count`
- `services/scheduling-engine/src/job-model.mjs::incrementFailureCount` — transitions to `errored` at `max_consecutive_failures`
- `services/scheduling-engine/src/quota.mjs::checkJobCreationQuota` / `getActiveJobCount` — `SELECT COUNT WHERE tenant_id=$1 AND workspace_id=$2 AND status='active'`
- `services/scheduling-engine/src/config-model.mjs::getConfig` — workspace config → tenant config → env default (waterfall)
- `services/scheduling-engine/migrations/001-scheduling-tables.sql` — `scheduling_configurations (tenant_id, workspace_id)`, `scheduled_jobs (tenant_id, workspace_id)`, `scheduled_executions (tenant_id, workspace_id)`
**Confidence:** high

---

## Domain M — Backup & Restore

### cap-backup-restore
**Name:** Backup/restore & PITR (tenancy-relevant)
**Summary:** Trigger on-demand backup for a specific `(tenant_id, component_type, instance_id)`; list snapshots; PITR simulation; trigger restore; query async operation audit; adapter capability check prevents backup on unsupported component types. Scope: `backup:write:own` (own tenant only) or `backup:write:global` (SRE cross-tenant). BACKUP_ENABLED flag can disable at deployment.
**Owning services:** backup-status
**Public surface:** `POST /v1/admin/backup/trigger`, `GET /v1/admin/backup/snapshots`, `POST /v1/admin/backup/restore`, `GET /v1/admin/backup/operations`, `GET /v1/admin/backup/audit`
**Evidence:**
- `services/backup-status/src/operations/trigger-backup.action.ts::main` — scope check (`backup:write:own`/`backup:write:global`); cross-tenant check `token.tenantId !== tenant_id → 403`; adapter `caps.triggerBackup` check; concurrent operation conflict → 409; emits `backup.requested`/`backup.rejected` audit events
- `services/backup-status/src/api/backup-status.auth.js::validateToken` — JWKS + jose; TEST_MODE guard in production
- `services/gateway-config/routes/backup-admin-routes.yaml` — backup route family (backup-admin, backup-status, backup-audit, backup-operations)
**Confidence:** high

---

## Domain N — Secrets Management

### cap-secrets
**Name:** Vault-backed secrets audit trail
**Summary:** Tails Vault audit log, sanitizes sensitive fields, and publishes events to `console.secrets.audit` Kafka topic with extended retention. Secret consumer acknowledgement tracked.
**Owning services:** secret-audit-handler
**Public surface:** Internal pipeline — Kafka topic `console.secrets.audit`
**Evidence:**
- `services/secret-audit-handler/src/index.mjs` — `createLogTailer(VAULT_AUDIT_LOG_PATH)` → `sanitize(entry)` → `publisher.publishAuditEvent(cleaned)` to `SECRET_AUDIT_KAFKA_TOPIC`
- `audit/recon.md:29` — `services/secret-audit-handler` sanitizes Vault events (code-confirmed above)
**Confidence:** high

---

## Domain O — Quotas, Plans & Capability Resolution

### cap-quotas-plans
**Name:** Commercial plans, quota policies & effective capability resolution (tenancy-relevant)
**Summary:** Plans map to `quotaPolicyId` + `deploymentProfileId` + `capabilityKeys`; quota modes: hard-blocked, soft-grace, soft-exhausted; hard limit rejects write + audits `quota.hard_limit_exceeded`; soft limit publishes alert to `quota.threshold.alerts` Kafka topic; `resolveTenantEffectiveCapabilities` / `resolveWorkspaceEffectiveCapabilities` compute effective capability = plan ∩ deployment-profile ∩ environment; usage snapshots metered across dimensions.
**Owning services:** internal-contracts, adapters (storage-capacity-quotas), gateway-config (plan-management-routes)
**Public surface:** `GET /v1/plans/*`, `GET /v1/quotas/*`, `GET /v1/platform/capabilities`
**Evidence:**
- `services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities` — intersects `plan.capabilityKeys` with `deploymentProfile.providerCapabilityIds`; throws on unknown plan
- `services/internal-contracts/src/index.mjs::resolveWorkspaceEffectiveCapabilities` — further filters by `capability.allowedEnvironments`
- `services/internal-contracts/src/index.mjs::buildCapabilityResolution` — output includes `quotas[]` with `enforcementMode`
- `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageQuotaAssignment` — reads `tenant.storage.bytes.max`, `tenant.storage.buckets.max` from quota policy
- `services/scheduling-engine/src/quota.mjs::readDefaultLimits` — `SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS` (default 10), `SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS` (default 60)
**Confidence:** high

---

## Domain P — Audit & Observability

### cap-audit
**Name:** Audit trail — event schema, pipeline, query, export & correlation
**Summary:** Structured audit events required fields: actor, scope_envelope (`tenant_id`, `workspace_id`), resource, action, result, origin, correlation_id; routed via Kafka subsystem pipeline; queryable by scope (tenant/workspace/platform); exportable in multiple formats with masking profiles; correlated by `correlationId` across timeline phases. Extended retention for security/capability-denial events.
**Owning services:** audit (contract-boundary), control-plane (observability-audit-*), all subsystems emit events
**Public surface:** `GET /v1/admin/audit/*` (query, export, correlation surfaces)
**Evidence:**
- `services/internal-contracts/src/index.mjs::getAuditEventRequiredFields` / `getAuditScopeEnvelope` / `getAuditActorSchema` — schema enforcement
- `services/internal-contracts/src/index.mjs::listAuditQueryScopes` / `listAuditExportScopes` / `listAuditCorrelationScopes` — query, export, correlation surfaces
- `services/internal-contracts/src/index.mjs::listAuditExportMaskingProfiles` — redaction/masking profiles
- `apps/control-plane/src/observability-audit-query.mjs` / `observability-audit-export.mjs` / `observability-audit-correlation.mjs` — control-plane modules per surface
- `services/audit/src/contract-boundary.mjs` — `capabilityEnforcementDeniedEvent` (security, extended retention)
**Confidence:** high

### cap-metrics
**Name:** Time-series metrics & health checks
**Summary:** Workspace and tenant time-series aggregation; metric families with cardinality controls; health probes per component; business metrics domains; threshold alerts to `quota.threshold.alerts` Kafka. Plan-gated by `observability.metrics.basic`.
**Owning services:** control-plane (observability-admin), all services export metrics
**Public surface:** `GET /v1/metrics/*`
**Evidence:**
- `services/internal-contracts/src/index.mjs::listObservabilityMetricFamilies` / `listObservedSubsystems` / `listObservabilityHealthComponents`
- `services/internal-contracts/src/index.mjs::getObservabilityBusinessMetricControls` — `requiredLabels`, `boundedDimensionCatalog`, `cardinalityControls`
- `services/gateway-config/base/public-api-routing.yaml` — `metrics` family, `planCapabilityAnyOf: [observability.metrics.basic]`
**Confidence:** high

---

## Domain Q — Gateway / Routing

### cap-gateway
**Name:** API gateway routing, idempotency & rate limiting
**Summary:** APISIX gateway at `/v1`; per-family rate limits (240/min for control, 180/min for auth, 30/min for native-admin); idempotency: `Idempotency-Key` required on POST/PUT/PATCH/DELETE, TTL 86400 s, body-hashed replay; `X-Correlation-Id` auto-generated if missing; capability-gated route enforcement; per-family QoS and timeout profiles; scope-enforcement plugin (configurable via `SCOPE_ENFORCEMENT_ENABLED`).
**Owning services:** gateway-config
**Public surface:** All `/v1/*` routes
**Evidence:**
- `services/gateway-config/base/public-api-routing.yaml::idempotencyHeader` — `requiredForMethods: [POST,PUT,PATCH,DELETE]`, `ttlSeconds: 86400`, `hashRequestBody: true`
- `services/gateway-config/base/public-api-routing.yaml::qosProfiles` — `platform_control: 240/min burst:60`; `native_admin: 30/min burst:10`
- `services/gateway-config/routes/capability-gated-routes.yaml` — 5 capability gates: webhooks, realtime, sql_admin_api, passthrough_admin, functions_public
- `services/gateway-config/base/public-api-routing.yaml::plugins.scope-enforcement` — `SCOPE_ENFORCEMENT_ENABLED` feature flag
**Confidence:** high

### cap-workspace-docs
**Name:** Workspace-scoped OpenAPI docs & SDK generation
**Summary:** Manages per-workspace OpenAPI spec versions; emits `openapi-spec-updated` events; triggers SDK generation (via `sdk-generation-completed` events); serves workspace docs.
**Owning services:** workspace-docs-service, openapi-sdk-service
**Public surface:** ⚠ HTTP routes not code-verified in gateway config; inferred from event schemas and migrations
**Evidence:**
- `services/internal-contracts/src/index.mjs::openapiSpecUpdatedEvent` / `sdkGenerationCompletedEvent` / `workspaceOpenApiVersion`
- `services/internal-contracts/src/index.mjs::workspaceCapabilityCatalogResponse` / `workspaceCapabilityCatalogAccessedEvent`
- `services/gateway-config/routes/workspace-capability-catalog.yaml` — workspace capability catalog route (confirmed file exists)
**Confidence:** medium (event schemas confirmed; HTTP handler implementation ⚠ not fully code-verified)
