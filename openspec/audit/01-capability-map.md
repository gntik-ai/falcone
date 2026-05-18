# Falcone Capability Map

Source-derived inventory of capabilities, built by reading code under `apps/`, `services/`, `internal-contracts/`, `charts/`, `helm/`, and `deploy/`. Existing docs, READMEs, and prior `openspec/` content were **not** treated as ground truth.

Each capability lists:
1. **Source paths** — directories that own the code.
2. **Public surface** — REST routes, action names, Kafka topics, CLI/UI screens, scopes.
3. **Data model touchpoints** — Postgres tables, Mongo collections, Kafka topics, Vault paths, external systems.
4. **Summary** — 1–2 lines.
5. **TODOs** — anything ambiguous from source alone.

Capabilities are grouped by domain. Cross-cutting layers (edge gateway, infra adapters, deployment) come last.

---

## A. Public API Contract (control-plane)

### A1. Unified Public API Contract
- **Source:** `apps/control-plane/openapi/` (control-plane.openapi.json + families/auth, iam, functions, postgres, mongo, etc.); `apps/control-plane/src/` (.mjs contract definitions, `saga/`, `workflows/`).
- **Public surface:** Declared v1 REST families under `/v1/{auth,iam,functions,postgres,mongo,storage,events,metrics}/...`. This app is the contract source-of-truth; routing/dispatch is performed by the gateway and per-domain services.
- **Data model touchpoints:** None directly. Imports `entity_read_model`, `entity_write_model`, `lifecycle_event`, `effective_capability_resolution` contracts from `services/internal-contracts/`.
- **Summary:** Authoritative OpenAPI definition for the public v1 surface; aggregates per-family fragments and exposes lifecycle/state-machine contracts shared with other services.
- **TODO:** Confirm whether `apps/control-plane/src/saga/` and `workflows/` are runtime code or contract-only modules.

---

## B. Identity, Auth, and Access

### B1. Keycloak Realm & Scope Configuration
- **Source:** `services/keycloak-config/scopes/` (scope manifests for backup-audit, backup-status, backup, backup-operations; platform admin scopes).
- **Public surface:** Scope tokens used by gateway/APISIX scope-enforcement plugin:
  - `backup-audit:read:global` (sre, superadmin)
  - `backup-audit:read:own` (tenant_owner — redacted projection)
  - `backup-status:read:{global,own,technical}`
  - `platform:admin:config:export`, `platform:admin:config:reprovision`
- **Data model:** Keycloak realm (deployed via chart) — no application DB.
- **Summary:** Declarative Keycloak scope definitions consumed by the gateway and downstream RBAC checks.
- **TODO:** No client/realm declarations were inspected; only scope files. Confirm whether realms/clients are defined elsewhere (chart values? bootstrap job?).

### B2. Realtime Auth & Scope Validation (library)
- **Source:** `services/realtime-gateway/src/` (`auth/`, `repositories/`, `actions/validate-subscription-auth.mjs`, `actions/handle-scope-revocation.mjs`, `migrations/`).
- **Public surface:** No HTTP server in this package — exposed as a library. Kafka topics published:
  - `console.realtime.auth-granted` / `.auth-denied`
  - `console.realtime.session-suspended` / `.session-resumed`
- **Data model:**
  - Postgres `realtime_sessions(id, tenant_id, workspace_id, actor_identity, token_jti, token_expires_at, status, last_validated_at, ...)`
  - Postgres `realtime_scope_channel_mappings(id, tenant_id, workspace_id, scope_name, channel_type, ...)`
  - External: Keycloak JWKS + introspection (env `KEYCLOAK_JWKS_URL`, `KEYCLOAK_INTROSPECTION_URL`).
- **Summary:** Validates realtime subscription tokens, manages session state, revokes on scope changes, and publishes auth audit events.
- **TODO:** No discoverable WebSocket/SSE server here; the actual transport must live in another component (likely consumes this library via APISIX-on-`/realtime`). Confirm.

---

## C. Tenants, Plans, Quotas, Provisioning

### C1. Plan & Tenant Provisioning (provisioning-orchestrator)
- **Source:** `services/provisioning-orchestrator/src/{actions,repositories,models,events,migrations,appliers,collectors,preflight,reprovision,schemas,observability}/`.
- **Public surface (actions invoked via gateway → OpenWhisk):**
  - Plan lifecycle: `plan-create`, `plan-get`, `plan-list`, `plan-update`, `plan-lifecycle`.
  - Plan assignment & history: `plan-assign`, `plan-assignment-get`, `plan-assignment-history`.
  - Plan capabilities & limits: `plan-capability-set`, `plan-capability-profile-get`, `plan-capability-audit-query`, `plan-limits-set/remove`, `plan-limits-tenant-get`, `plan-limits-profile-get`.
  - Quota enforcement & overrides: `quota-enforce`, `quota-override-{create,modify,revoke}`, `quota-audit-query`.
  - Async operations: `async-operation-create` (`POST /api/operations`), `async-operation-{query,transition,cancel}`, sweeps for timeout/orphans.
  - Tenant config lifecycle: `tenant-config-{export,preflight,reprovision,validate,migrate}`.
  - Secret rotation: `secret-rotation-{initiate,revoke,expiry-sweep}`.
  - Privilege/scope governance: `privilege-domain-{assign,audit-query}`, `scope-enforcement-{audit-query,event-recorder}`.
- **Data model (Postgres, from migrations/):**
  - `plans`, `tenant_plan_assignments`, `plan_audit_events`.
  - `quota_overrides`, `quota_enforcement_log`, `quota_dimension_catalog`, `workspace_sub_quotas`, `effective_entitlements`.
  - `async_operations`, `operation_policies`.
  - `credential_rotation_state`, `credential_rotation_history`.
  - Capture config tables: `pg_capture_config`, `mongo_capture_config` (config plane for CDC bridges).
  - Realtime tables: `realtime_channels`, `realtime_subscriptions`, `subscription_quotas`.
- **Kafka:** Emits `plan.created/updated`, `quota.enforced`, `operation.completed` (and others — full topic list not exhaustively enumerated).
- **Summary:** Core control-plane engine for plans, tenant entitlements, quota enforcement, long-running operations, tenant config export/reprovision, and credential rotation.
- **TODO:** Confirm whether realtime/CDC capture tables are co-owned with the realtime/CDC services or owned solely here. Confirm exact Kafka topic schema/retry config.

### C2. Workspace Capability Catalog
- **Source:** Surfaced via gateway routes `GET /v1/workspaces/:workspaceId/capability-catalog` (→ provisioning-orchestrator), built from `services/openapi-sdk-service/src/capability-modules/*.paths.json` and `provisioning-orchestrator/src/collectors/`.
- **Public surface:** `GET /v1/workspaces/{workspaceId}/capability-catalog`, `GET .../capability-catalog/{capabilityId}`.
- **Data model:** Sourced from plan entitlements + per-workspace overrides (provisioning DB) and capability manifests (JSON files).
- **Summary:** Per-workspace projection of enabled capabilities, used by gateway feature gates and SDK generation.
- **TODO:** No dedicated handler file was found by name; precise route handler module within provisioning-orchestrator was not traced end-to-end. Verify.

---

## D. Data Platform — PostgreSQL

### D1. PostgreSQL Admin & Data API (adapters)
- **Source:** `services/adapters/src/postgresql-admin.mjs`, `postgresql-data-api.mjs`, `postgresql-governance-admin.mjs`, `postgresql-structural-admin.mjs`, `authorization-policy.mjs`.
- **Public surface (via gateway → adapter actions):**
  - `POST /v1/postgres/workspaces/{workspaceId}/admin/{dbName}/sql` (and related admin + capture routes — declared in `apps/control-plane/openapi/`).
  - CRUD data API: list/get/insert/update/delete/rpc.
- **Data model:** Customer-managed Postgres databases (per workspace/tenant) — accessed through the adapter, not stored in platform schema.
- **Summary:** Admin (DDL, governance) and data-plane (CRUD/RPC) Postgres surfaces wrapped behind a uniform adapter with RBAC.
- **TODO:** Multi-DB / per-workspace database provisioning lifecycle not traced here — likely provisioning-orchestrator territory.

### D2. PostgreSQL Change Capture (pg-cdc-bridge)
- **Source:** `services/pg-cdc-bridge/src/` (`PgWalListener.mjs`, `WalListenerManager.mjs`, `WalEventDecoder.mjs`, `KafkaChangePublisher.mjs`, `CaptureConfigCache.mjs`, `RouteFilter.mjs`, `HealthServer.mjs`, `MetricsCollector.mjs`).
- **Public surface:**
  - `GET /health`, `GET /metrics` (port 8080).
  - Kafka produced: `{tenant_id}.{workspace_id}.pg-changes` (prefix env-configurable).
  - CloudEvents headers: `ce-type=console.pg-capture.change`, `ce-tenantid`, `ce-workspaceid`, `ce-source=/data-sources/{ref}/tables/{schema}.{table}`.
- **Data model:**
  - Postgres `pg_capture_configs` (read).
  - Postgres logical replication slot per source: `cdc_{sha1(dataSourceRef)[:8]}` (pgoutput).
- **Summary:** Decodes WAL via logical replication and publishes per-row CloudEvents change records to Kafka.
- **TODO:** Internal WAL event schema in `WalEventDecoder.mjs` not transcribed.

---

## E. Data Platform — MongoDB

### E1. MongoDB Admin (adapters)
- **Source:** `services/adapters/src/mongodb-admin.mjs`.
- **Public surface (via gateway):** Mongo admin routes declared under `apps/control-plane/openapi/families/mongo/...` — databases, collections, indexes, views, templates, users, role bindings.
- **Data model:** Customer-managed MongoDB; control-plane events emitted as `mongo_admin_event` (see audit).
- **Summary:** Adapter providing programmatic admin surface for tenant Mongo deployments.

### E2. MongoDB Change Capture (mongo-cdc-bridge)
- **Source:** `services/mongo-cdc-bridge/src/` (`ChangeStreamWatcher.mjs`, `ChangeStreamManager.mjs`, `KafkaChangePublisher.mjs`, `MongoCaptureConfigCache.mjs`, `ResumeTokenStore.mjs`, `MongoChangeEventMapper.mjs`, `HealthServer.mjs`).
- **Public surface:**
  - `GET /health`, `GET /metrics`.
  - Kafka produced: `{tenant_id}.{workspace_id}.mongo-changes`.
- **Data model:**
  - Postgres `mongo_capture_configs`, `mongo_capture_audit_log`, `mongo_capture_resume_tokens`.
  - MongoDB change streams (insert/update/replace/delete) with resume token recovery.
- **Summary:** Watches Mongo change streams per workspace, maps to CloudEvents, publishes to Kafka with audit trail and durable resume tokens.
- **TODO:** Mapper transformation details and `invalidate`-event handling not fully traced.

---

## F. Events & Realtime

### F1. Event Gateway (publish/subscribe surface)
- **Source:** `services/event-gateway/src/` (`runtime.mjs`, `kafka-integrations.mjs`, `contract-boundary.mjs`).
- **Public surface (declared in source):**
  - `POST /v1/events/publish`, `POST /v1/events/subscribe`, `GET /v1/events/topics/{resourceId}/metadata`.
  - `GET /v1/metrics/workspaces/{workspaceId}/kafka-topics`, `.../event-dashboards`.
  - Transports: `http_publish`, `sse`, `websocket`. Encodings: `json`, `base64`. ACK: `implicit`/`explicit`. Replay: `latest|earliest|last_event_id|from_timestamp|window`.
  - Bridges from sources: `postgresql`, `mongodb`, `storage`, `openwhisk`, `iam`.
- **Data model:** Kafka topics per workspace; per-plan limits encoded in `runtime.mjs` (payload size, headers, batch, in-flight, heartbeat).
- **Summary:** Multi-transport event broker with plan-tiered limits, source bridges, dashboards, and per-topic metadata APIs.
- **TODO:** Module exports an in-memory runtime but no Fastify/Express bootstrap was found in this package — likely served via gateway-wired OpenWhisk actions or an external server. Verify.

### F2. Realtime Subscriptions Transport
- **Source:** APISIX route `/realtime` → upstream service (chart `charts/realtime-gateway/`).
- **Public surface:** WebSocket/SSE endpoints under `/v1/workspaces/*/realtime*` (gateway-config `routes/`).
- **Data model:** Reuses [[B2]] tables and audit topics.
- **Summary:** Externally-exposed realtime transport guarded by `realtime` capability gate; auth/scope state comes from B2.
- **TODO:** The transport binary itself (WebSocket server) is referenced in charts but its source location was not pinpointed. May be in a not-yet-audited folder or built from `realtime-gateway` package in a non-obvious way.

### F3. Webhook Engine
- **Source:** `services/webhook-engine/src/` and `services/webhook-engine/actions/`.
- **Public surface:**
  - `POST /v1/webhooks/subscriptions` (201 + `signingSecret`), `GET /v1/webhooks/subscriptions`, `GET/{id}`, `PATCH/{id}`, `DELETE/{id}`.
  - `GET /v1/webhooks/event-types`.
  - Kafka emitted: `console.webhook.subscription.{created,updated,deleted,paused,resumed,secret-rotated}`.
- **Data model (Postgres):** `webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries` (UNIQUE on `subscription_id, event_id`), `webhook_delivery_attempts`.
- **Other:** Oversized payloads spilled to S3 (`s3://webhook-payloads/{uuid}`); HTTPS-only with private-IP rejection; auto-disable on consecutive failures.
- **Summary:** Webhook subscription/delivery service with HMAC signing, retry scheduling, payload spillover, and quota.
- **TODO:** Signing algorithm details not transcribed.

---

## G. Storage

### G1. Object Storage Adapter
- **Source:** `services/adapters/src/storage-*.mjs` (11 modules: provider-profile, tenant-context, bucket-object-ops, capacity-quotas, error-taxonomy, event-notifications, import-export, logical-organization, multipart-presigned, programmatic-credentials, usage-reporting, audit-ops, access-policy) plus `provider-catalog.mjs`.
- **Public surface (via gateway → catalog routes):**
  - `GET|POST|PUT|DELETE /v1/objects/{bucket}/{key}` (data_access scope).
  - `/v1/storage/workspaces/{workspaceId}/...` (declared in control-plane OpenAPI).
- **Data model:** External object store (provider abstraction). Programmatic credentials, presigned URLs, event notifications, capacity quotas tracked through adapter modules.
- **Summary:** Provider-agnostic object storage façade with credentials, quotas, presigned URLs, notifications, and audit.
- **TODO:** Concrete provider implementations (S3/GCS/Azure/MinIO) and which are supported in deployment were not confirmed — `SUPPORTED_STORAGE_PROVIDER_TYPES` referenced but values not inspected.

---

## H. Functions / Serverless

### H1. OpenWhisk Function Admin & Invocation
- **Source:** `services/adapters/src/openwhisk-admin.mjs`. Per-action wiring throughout the codebase (provisioning-orchestrator actions, scheduling, webhooks, backup, tenant-config etc. all run as OpenWhisk actions per gateway routes).
- **Public surface:**
  - `POST /v1/functions/{id}` (deploy — `function_deployment` scope).
  - `POST /v1/functions/{id}/invoke` (`data_access + function_deployment`).
  - `/v1/functions/workspaces/{workspaceId}/{actions,quota,audit,secrets,triggers,packages}` (declared in OpenAPI).
  - `/v1/functions/tenants/{tenantId}/quota`.
- **Data model:** Functions/actions metadata + secrets — backed by OpenWhisk and Vault; quotas live in provisioning DB.
- **Summary:** Tenant-facing serverless surface backed by OpenWhisk, with deployment, invocation, triggers, secrets, and quota.
- **TODO:** Where function package storage, code-build, and trigger registration concretely live in the repo was not traced.

---

## I. Scheduling

### I1. Scheduling Engine
- **Source:** `services/scheduling-engine/src/`, `actions/scheduling-management.mjs`, `actions/scheduling-trigger.mjs`, `actions/scheduling-job-runner.mjs`, `migrations/001-scheduling-tables.sql`.
- **Public surface (REST):**
  - `GET/PATCH /v1/scheduling/config`
  - `GET /v1/scheduling/summary`
  - `POST/GET /v1/scheduling/jobs`, `GET/PATCH/DELETE /v1/scheduling/jobs/{jobId}`
  - `POST /v1/scheduling/jobs/{jobId}/{pause,resume}`
  - `GET /v1/scheduling/jobs/{jobId}/executions`
- **Background actions:** `scheduling-trigger` (poller, backfill), `scheduling-job-runner` (executor).
- **Data model (Postgres):** `scheduling_configurations`, `scheduled_jobs`, `scheduled_executions` (UNIQUE on `job_id, scheduled_at`).
- **Summary:** Cron job manager with quota, auto-pause on consecutive failures, missed-execution backfill, and full audit event set.
- **TODO:** `validateTargetAction` callback contract is injected; resolution to a concrete action validator not traced.

---

## J. SDK & Spec Generation

### J1. OpenAPI / SDK Builder
- **Source:** `services/openapi-sdk-service/src/`, `actions/sdk-generate.mjs`, `actions/openapi-spec-regenerate.mjs`, `actions/openapi-spec-serve.mjs`, `src/capability-modules/*.paths.json`, `migrations/088-workspace-*.sql`.
- **Public surface:**
  - `POST /v1/workspaces/{workspaceId}/sdks` (202 + statusUrl; body `{language}` — `typescript`, `python`).
  - `GET /v1/workspaces/{workspaceId}/sdks/{language}/status`.
  - Kafka emitted: `sdkGenerationCompleted`.
- **Data model (Postgres):**
  - `workspace_openapi_versions(id, tenant_id, workspace_id, spec_version, content_hash, format_json, format_yaml, capability_tags[], is_current)`
  - `workspace_sdk_packages(id, tenant_id, workspace_id, language, spec_version, status, download_url, url_expires_at, error_message)`
- **Summary:** Assembles per-workspace OpenAPI from enabled capability modules, versions it (semver based on capability add/remove), and builds + stores per-language SDK packages.
- **TODO:** `buildSdk` and `uploadSdkArtefact` are dependency-injected; concrete builder/upload backends not located in this service.

---

## K. Workspace Documentation

### K1. Workspace Docs Service
- **Source:** `services/workspace-docs-service/src/`, `actions/workspace-docs.mjs`, `migrations/087-workspace-doc-notes.sql`.
- **Public surface:**
  - `GET /docs` (viewer role; records access audit).
  - `POST /docs/notes`, `PUT /docs/notes/{noteId}`, `DELETE /docs/notes/{noteId}` (admin only; soft delete).
  - API version pin via header: `2026-03-01`.
- **Data model (Postgres):**
  - `workspace_doc_notes(id, tenant_id, workspace_id, content, author_id, created_at, updated_at, deleted_at)`.
  - `workspace_doc_access_log(workspace_id, actor_id, access_date PK)`.
- **Summary:** Per-workspace docs assembler with admin-authored notes and access audit.
- **TODO:** Kafka topic for `recordAccess` not found explicitly in source.

---

## L. Backup & Restore

### L1. Backup Status, Operations, Audit
- **Source:** `services/backup-status/src/{api,operations,collector,adapters,confirmations,audit,db/migrations}`.
- **Public surface:**
  - `GET /v1/backup/status` (Bearer + scope; query `?tenant_id=...`; respects `read:global`/`own`/`technical`).
  - Gateway routes (from `services/gateway-config/routes/`) targeting OpenWhisk:
    - `POST /v1/backup/trigger` → `openwhisk-backup-trigger`
    - `POST /v1/backup/restore` → `openwhisk-backup-restore`
    - `GET /v1/backup/operations/*` → `openwhisk-get-operation`
    - `GET /v1/backup/snapshots` → `openwhisk-list-snapshots`
  - Admin scope routes: `GET /v1/admin/backup/scope`, `GET /v1/tenants/*/backup/scope` (rate 30 req/s).
- **Adapters:** `postgresql.adapter.ts`, `mongodb.adapter.ts`, `s3.adapter.ts`, `keycloak.adapter.ts`, `kafka.adapter.ts` in `src/adapters/`.
- **Data model (Postgres):**
  - `backup_status_snapshots(tenant_id, component_type, instance_id, instance_label, deployment_profile, is_shared_instance, status, last_successful_backup_at, last_checked_at, detail, adapter_metadata JSONB, collected_at)`.
  - `backup_operations(id, type {backup|restore}, tenant_id, component_type, instance_id, status, requester_id, requester_role, snapshot_id, failure_reason{,_public}, adapter_operation_id, timestamps, metadata JSONB)`.
  - `backup_audit_events` (migration not transcribed), `restore_confirmations` (migration not transcribed).
- **Kafka:** `platform.backup.operation.events` (env `KAFKA_TOPIC`); event names `backup_operation_completed/failed`.
- **Summary:** Multi-component backup observability + operation dispatch (backup/restore, simulation mode), per-tenant and global scopes, audit trail, and adapter-based polling.
- **TODO:** Adapter interface contract, restore-confirmations flow, and audit event schema not fully traced from inspected files.

### L2. Backup Audit Reporting UI
- **Source:** `apps/console/src/` (separate from `web-console`):
  - `pages/admin/BackupAuditPage.tsx`, `pages/tenant/BackupAuditSummaryPage.tsx`.
  - `components/backup/{AuditEventTable,AuditEventDetail,AuditEventFilters}.tsx`.
  - `lib/api/backup-audit.api.ts`.
- **Public surface:** UI screens — `/backup-audit` (admin), `/backup-audit-summary` (tenant).
- **Data model:** Calls audit query API; AuditEvent shape: `id, tenant_id, actor_id, action_type, timestamp, resource_type, change_details, correlation_id`.
- **Summary:** Specialized React app for backup/restore audit inspection — admin and tenant projections.
- **TODO:** Backend route serving these audit queries was not located by name — likely backup-status or audit service.

---

## M. Audit & Observability

### M1. Audit Contract Surface
- **Source:** `services/audit/src/contract-boundary.mjs`, `services/audit/src/authorization-context.mjs`; `services/internal-contracts/src/observability-audit-{pipeline,event-schema}.json`, `authorization-model.json`, plus event contracts (operation-retry, operation-cancel, operation-timeout, failure-classified, manual-intervention-required, …).
- **Public surface (event types exposed to consumers):**
  - `audit_record`, `iam_lifecycle_event`, `mongo_admin_event`, `kafka_admin_event`, `capability_enforcement_denied`.
  - Actor types: `platform_user, tenant_user, workspace_user, service_account, system, provider_adapter`. Scope modes: `tenant, tenant_workspace, platform`. Freshness SLA: 300s.
- **Data model:** Contract-only — consumers in other services persist/query.
- **Summary:** Cross-service contract boundary for audit/lifecycle events and authorization decisions.
- **TODO:** Downstream audit storage/query/export implementations not located in this service.

### M2. Secret Audit Pipeline
- **Source:** `services/secret-audit-handler/src/` (`index.mjs`, `vault-log-reader.mjs`, `sanitizer.mjs`, `event-schema.mjs`, `kafka-publisher.mjs`).
- **Public surface:** Kafka topic `console.secrets.audit` (env `SECRET_AUDIT_KAFKA_TOPIC`).
- **Event schema:** `SecretAuditEvent { eventId, timestamp, operation∈{read,write,delete,denied}, domain∈{platform,tenant,functions,gateway,iam}, secretPath, secretName, requestorIdentity, result∈{success,denied,error}, vaultRequestId }`; fields `value/data/secret/password/token/key` are forbidden and stripped.
- **Data model:** Tails Vault audit log at `/vault/audit/vault-audit.log` (env `VAULT_AUDIT_LOG_PATH`); produces to Kafka via KafkaJS with retries.
- **Summary:** Sanitizing pipeline from Vault audit log to a sanitized Kafka audit stream — guarantees secret material never leaves the boundary.
- **TODO:** No log rotation/truncation handling visible.

### M3. Secret Metadata API (contracts)
- **Source:** `internal-contracts/secrets/secret-metadata-v1.yaml`, `secret-inventory-v1.yaml`, `secret-audit-event-v1.yaml`.
- **Public surface:**
  - `GET /v1/secrets/{domain}/{path}` (domain ∈ platform/tenant/functions/gateway/iam).
  - `GET /v1/secrets/inventory?domain=&tenantId=&offset=&limit=` (limit 1–200).
- **Data model:** Contract-only; backing impl not in this folder.
- **Summary:** Contracts for secret metadata browsing (never returns secret values).
- **TODO:** Concrete server implementation for these endpoints not located in audited services.

### M4. Observability & Metrics (control surface)
- **Source:** `apps/control-plane/openapi/families/` (metrics family); `provisioning-orchestrator/src/observability/`; `scripts/validate-observability-*.mjs` (validator scripts).
- **Public surface (declared in OpenAPI):**
  - `GET /v1/metrics/tenants/{tenantId}/{overview,usage,quotas,audit,...}`
  - `GET /v1/metrics/workspaces/{workspaceId}/{overview,usage,quotas,audit,kafka-topics,event-dashboards,...}`
- **Data model:** Aggregates over provisioning DB + Prometheus (chart-deployed) + audit topics.
- **Summary:** Tenant/workspace-scoped metrics, usage, quota, and audit query API.
- **TODO:** Concrete handlers for the metrics family were not pinpointed; likely served by provisioning-orchestrator with Prometheus reads.

---

## N. Edge Gateway

### N1. APISIX Gateway Configuration
- **Source:** `services/gateway-config/{routes,base,openapi-fragments,plugins,helm}`, `public-route-catalog.json`.
- **Public surface:** Edge routes declared in `routes/*.yaml`, including:
  - **Structural admin** (gated by `structural_admin` scope): `/v1/{tenants,workspaces,schemas,functions,api-keys,services/configure,quotas}/...`.
  - **Data access** (gated by `data_access`): `/v1/{collections/.../documents,objects/{bucket}/{key},analytics/query,events/{publish,subscribe}}`.
  - **Functions invoke**: `/v1/functions/{id}/invoke` (composite scope).
  - **Plan management** → provisioning-orchestrator.
  - **Backup** → OpenWhisk action upstreams (`openwhisk-backup-*`).
  - **Tenant config** → `openwhisk-tenant-config-export`, `...-export-domains`.
  - **Workspace capability catalog** → provisioning-orchestrator.
  - **Capability-gated routes** (feature flags): `webhooks`, `realtime`, `sql_admin_api`, `passthrough_admin`, `functions_public`.
  - Public-surface ingress maps: `api`, `identity`, `realtime`, `console` (chart `templates/public-surface`).
- **Plugins:** Keycloak OpenID, scope-enforcement, rate limiting (2–30 req/s), Kafka audit logger on `console.audit.gateway`.
- **Summary:** Source-of-truth APISIX route table mapping public v1 endpoints to backend services and OpenWhisk actions, with scope, rate, capability, and audit policy.
- **TODO:** Catalog routes (collections, objects, analytics) lack explicit upstream targets in the routes YAML — upstream may be resolved indirectly (e.g., per-tenant subdomain or a separate consolidated route file).

---

## O. Infra Adapters

### O1. Backing System Adapters
- **Source:** `services/adapters/src/*.mjs` (26 modules total).
- **Surface (not HTTP — programmatic):**
  - Kafka: `kafka-admin.mjs` (topics, ACLs, isolation modes, audit modes).
  - MongoDB: `mongodb-admin.mjs` (see [[E1]]).
  - PostgreSQL: see [[D1]].
  - OpenWhisk: `openwhisk-admin.mjs`.
  - Keycloak: `keycloak-admin.mjs`.
  - Storage: see [[G1]].
- **Cross-cutting:** `authorization-policy.mjs`, `provider-catalog.mjs`.
- **Summary:** Per-system adapter modules with uniform RBAC and provider abstraction — consumed by handlers in other services.

### O2. Internal Contracts (cross-service registry)
- **Source:** `services/internal-contracts/src/` (JSON contract files), `internal-contracts/secrets/` (YAML secret contracts).
- **Surface:** Contract artifacts referenced by `apps/control-plane/`, `services/audit/`, `services/provisioning-orchestrator/`, etc.
- **Summary:** Shared canonical contracts: entity read/write models, lifecycle events, observability audit pipeline/event schema, authorization model, operation lifecycle events.

---

## P. Deployment Topology

### P1. Helm Charts & Kubernetes Manifests
- **Source:** `charts/in-falcone/` (umbrella), `charts/realtime-gateway/`, `charts/workspace-docs-service/`, `helm/charts/backup-status/`, `deploy/{apisix/routes,helm,k8s}`.
- **Deployed components (from chart dependencies):**
  - APISIX (gateway), Keycloak (identity), PostgreSQL, MongoDB, Kafka, OpenWhisk, object storage (provider-abstracted), Prometheus/observability stack (conditional), control-plane (conditional), web-console.
  - Companions: realtime-gateway, workspace-docs-service, scheduling-engine (as OpenWhisk action), webhook-engine (as OpenWhisk action), backup-status (OpenWhisk rules/triggers/actions/alarms).
- **Public ingress surfaces:** `api → APISIX/control-plane`, `identity → Keycloak/auth`, `realtime → APISIX/realtime`, `console → web-console/`. Optional `{workspaceSlug}.apps.{env}...`.
- **Summary:** Umbrella Helm deployment of the platform across four public ingress hosts; profiles for dev/prod/customer/airgap.
- **TODO:** `customer-reference.yaml` and `airgap.yaml` values referenced but not present (or not located) under inspected paths. Confirm storage provider type used in default deployment.

---

## Z. Open Questions / Cross-Cutting TODOs

- **HTTP wiring for action-style services.** Many services expose "actions" (provisioning-orchestrator, scheduling, openapi-sdk-service, workspace-docs-service, webhook-engine, backup operations). The OpenWhisk runtime is the bridge per gateway routes, but the deploy-time mapping (action name → file → registration) was not enumerated end-to-end.
**Answer** Provide me the enumeration or an list of options that, in your opinion are valid
- **Function platform (H1) source layout.** Action management, package/secret storage, and trigger registration code was not located by name.
**Answer** Locate and give me different solutions and ideas
- **Realtime transport (F2) source.** APISIX exposes `/realtime`; the actual WS/SSE server binary location was not pinpointed.
**Answer** Find the best solution and propose me
- **Metrics handlers (M4).** OpenAPI declares the family but concrete handlers were not located.
**Answer** Find the best solution and propose me
- **Catalog routes (collections/objects/analytics) upstreams.** Declared in OpenAPI and gated in scope policy, but upstream mapping not in inspected gateway-config YAMLs.
**Answer** Find the best solution and propose me
- **Kafka topic taxonomy.** A consolidated list of all topics (produced/consumed by each service) was not assembled — only per-service samples.
**Answer** create a consolidated list
- **Plan tiers.** `event-gateway/src/runtime.mjs` references starter/growth/enterprise tiers; whether plan slugs match elsewhere (provisioning-orchestrator `plans` table) was not verified.
**Answer** Find the best solution and propose me

This map is the input for subsequent OpenSpec capability proposals; do not derive specs from any item still flagged TODO until source verification is added.
