# Recon — Falcone codebase map (source-only)

> Multitenant BaaS. Derived from source, build/config, schemas and the observable public surface only. Evidence cited as `path`, `path::symbol`, or `file:line`.

## Languages & Runtimes

- **Primary runtime:** Node.js (v20+), ES modules (`type: "module"`)
- **Package manager:** pnpm (v10.0.0)
- **Build orchestrator:** Turbo
- **Frontend framework:** React 18.3 + TypeScript + Vite
- **Evidence:** `package.json` (Node v20, pnpm@10.0.0), `apps/web-console/package.json` (React, Vite, vitest), `.github/workflows/ci.yml` (CI targets Node 20)

## Monorepo Layout

**Root workspace:** pnpm monorepo with three main trees: `apps/`, `services/`, `tests/`, plus centralized `internal-contracts/`, `helm/`, `charts/`, `scripts/`, `deploy/`, `openspec/`, `audit/`. Evidence: `pnpm-workspace.yaml` (packages: apps/*, services/*, tests/*, docs-site).

### Apps

- **control-plane** (`apps/control-plane/`) — Central orchestration hub; exposes 249+ REST endpoints organized into API families (platform, tenants, workspaces, auth, postgres, mongo, events, functions, storage, metrics, websockets, IAM, backup, plans, quotas). Entry: OpenAPI spec at `apps/control-plane/openapi/control-plane.openapi.json` (package.json is a placeholder). Submodules: `apps/control-plane/src/{tenant-management,workspace-management,postgres-admin,mongo-admin,functions-admin,storage-admin,iam-governance,observability-admin}.mjs`.
- **web-console** (`apps/web-console/`) — React UI for workspace/tenant administration; `vite preview --host 127.0.0.1 --port 4173`. Entry: `apps/web-console/src/main.tsx` → `src/router.tsx`. Client-side only (no API).

### Services

- **gateway-config** (`services/gateway-config/`) — APISIX gateway config: public API routing, middleware policies, per-route timeouts/retries, request validation, idempotency. Public domain `in-falcone.example.com`, port 8080, base path `/v1`. Idempotency header `Idempotency-Key` (required POST/PUT/PATCH/DELETE; 86400s TTL; body hashed). Error envelope w/ correlationId, `X-Correlation-Id`. Evidence: `services/gateway-config/base/{gateway.yaml,public-api-routing.yaml}`, `services/gateway-config/routes/*.yaml`.
- **realtime-gateway** (`services/realtime-gateway/`) — WebSocket server for real-time subscriptions; JWT/introspection auth; scope enforcement; tenant/workspace isolation via session context. Public symbols: `createTokenValidator()`, `SessionManager`, `ScopeChecker`. Auth flow: Bearer → `src/auth/token-validator.mjs` (jose jwtVerify + JWKS; introspection fallback) → claims (sub, tenant_id, scopes, authorizedWorkspaces) → `src/auth/session-manager.mjs` (session in Postgres) → `src/auth/scope-checker.mjs`. Isolation: `session.tenantId` checked in `tenant-workspace-guard.mjs` on publish.
- **webhook-engine** (`services/webhook-engine/`) — Webhook subscription/delivery + SSRF guarding; signed payloads; retries. `src/webhook-subscription.mjs::normalizeNumericIPv4()`, `isBlockedIp()` (link-local 169.254/16, private 10/8 + 192.168/16, loopback 127/8, ULA fc00::/7, link-local fe80::/10). Table `webhook_subscriptions` indexed `(tenant_id, workspace_id)`. Migration `services/webhook-engine/migrations/001-webhook-subscriptions.sql`.
- **pg-cdc-bridge** (`services/pg-cdc-bridge/`) — Postgres WAL CDC → Kafka; tenant-scoped change events. Entry `src/index.mjs`. Env `PG_CDC_PG_CONNECTION_STRING`, `PG_CDC_KAFKA_BROKERS`, `PG_CDC_KAFKA_TOPIC_PREFIX`, `PG_CDC_CACHE_TTL_SECONDS`, `PG_CDC_HEALTH_PORT`. Topic derivation includes `tenantId`+`workspaceId`.
- **mongo-cdc-bridge** (`services/mongo-cdc-bridge/`) — Mongo change streams → Kafka; audit events include tenant_id, workspace_id, actor_identity. Entry `src/index.mjs`. Audit `INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, after_state)`.
- **secret-audit-handler** (`services/secret-audit-handler/`) — Vault audit log tailer → Kafka. Entry `src/index.mjs`. Env `VAULT_AUDIT_LOG_PATH` (default `/vault/audit/vault-audit.log`), `KAFKA_BROKERS`, `SECRET_AUDIT_KAFKA_TOPIC` (default `console.secrets.audit`).
- **scheduling-engine** (`services/scheduling-engine/`) — Cron scheduling/triggering/execution + quota enforcement. Models `src/{config-model,job-model,execution-model,quota}.mjs`. Audit events `job.*`, `execution.*`, `capability.toggled`, `quota.exceeded` (all include tenantId, workspaceId). Migration `migrations/001-scheduling-tables.sql` with `(tenant_id, workspace_id)` indices.
- **provisioning-orchestrator** (`services/provisioning-orchestrator/`) — Tenant/workspace provisioning sagas; async op state machine; preflight validation; appliers. `src/authorization-context.mjs` exports enforcement boundaries. `src/{actions,appliers,collectors,models,repositories,schemas,migrations,saga}/*.mjs`.
- **backup-status** (`services/backup-status/`) — Backup/restore orchestration; PITR simulation; snapshot listing; S3/Postgres/Mongo adapters. OpenWhisk actions `src/operations/*.action.ts` via `operation-dispatcher.ts`. JWT via jose + jwks-rsa.
- **audit** (`services/audit/`) — Audit contract definitions/enforcement surfaces: `src/contract-boundary.mjs`, `src/authorization-context.mjs`. `capabilityEnforcementDeniedEvent` (security, extended retention).
- **event-gateway** (`services/event-gateway/`) — Event routing / Kafka integrations (placeholder package.json; logic likely in actions/shared modules).
- **internal-contracts** (`services/internal-contracts/`) — Centralized contracts (44 JSON files: deployment-topology, domain-model, authorization-model, observability-*, public-api-*, saga-contract, event schemas) + typed accessors `resolveTenantEffectiveCapabilities()`, `resolveWorkspaceEffectiveCapabilities()`, `buildCapabilityResolution()`. Entry `src/index.mjs`.
- **adapters** (`services/adapters/`) — Integration adapters: `src/{storage-tenant-context,postgresql-data-api,mongodb-data-api,kafka-admin,keycloak-admin,openwhisk-admin,storage-access-policy,storage-event-notifications,storage-capacity-quotas,provider-catalog}.mjs`. `storage-tenant-context.mjs` resolves tenant capabilities + storage quotas.
- **workspace-docs-service** (`services/workspace-docs-service/`) — Workspace-scoped docs/OpenAPI spec mgmt. Migrations `087-*`, `088-*`.
- **openapi-sdk-service** (`services/openapi-sdk-service/`) — OpenAPI SDK generation. Migration `088-*`.

## Build & Config Entry Points

- **Root:** `turbo.json` (lint, test, typecheck).
- **CI:** `.github/workflows/ci.yml` — quality job (lint, unit, contract, E2E scaffolding, plan enforcement, resilience, hardening); security job (dependency audit, image policy). Artifacts: control-plane OpenAPI, deployment topology, domain model, plan enforcement/upgrade results.
- **Helm:** `helm/`, `helm/charts/backup-status/`, bootstrap migrations `charts/in-falcone/bootstrap/migrations/`.

## Public Surface

### HTTP/REST API (via APISIX gateway at `/v1`)

Families (from `apps/control-plane/openapi/control-plane.openapi.json`, 249 paths):
- **Platform** `/v1/platform/*` (capabilities, route catalog, billing, plans, quotas, deployment profiles)
- **Tenants** `/v1/tenants/*`, `/v1/admin/tenants/*` (CRUD, lifecycle, quotas, governance)
- **Workspaces** `/v1/workspaces/*`, `/v1/admin/workspaces/*` (CRUD, lifecycle, membership, inheritance, clone)
- **Auth** `/v1/auth/*` (login sessions, password recovery, signup, access-checks, signups policy)
- **PostgreSQL** `/v1/postgres/*` (data API, admin, governance, captures, metrics, audit)
- **MongoDB** `/v1/mongo/*` (data API, admin, governance, captures, metrics, audit)
- **Events** `/v1/events/topics*`, `/v1/events/topics/{resourceId}/*`
- **Functions** `/v1/functions/*` (CRUD, activations, invocations, triggers cron/kafka/storage, versions, audit, rollback)
- **Storage** `/v1/storage/*` (buckets, multipart, presigned, access policies, event notifications, capacity)
- **Metrics** `/v1/metrics/*` (workspaces/tenants time-series aggregation)
- **WebSockets** `/v1/websockets`
- **Backup** `/v1/admin/backup/*` (trigger, snapshots, PITR simulation, restore, operations query, audit)
- **IAM** `/v1/admin/iam/*` (realm, client, role, scope, user; Keycloak-backed)
- **External Applications / Service Accounts** `/v1/*/applications*`, `/v1/*/service-accounts*` (OAuth2 clients, API keys)
- **Plans & Quotas** `/v1/plans/*`, `/v1/quotas/*`

Capability-gated routes (require plan inclusion): webhooks `/v1/workspaces/*/webhooks*`, realtime `/v1/workspaces/*/realtime*` + `/v1/events/subscribe`, SQL `/v1/workspaces/*/sql*` + `/admin/sql*`, passthrough `/v1/workspaces/*/admin/passthrough*`, functions `/v1/functions/*/invoke` + `/v1/workspaces/*/functions/public*`, kafka `/v1/workspaces/*/admin/kafka*`. Evidence: `services/gateway-config/routes/*.yaml`.

### Messaging (Kafka)

- CDC: `{PG_CDC_KAFKA_TOPIC_PREFIX}.{tenant_id}.{workspace_id}`, `{MONGO_CDC_KAFKA_TOPIC_PREFIX}.{tenant_id}.{workspace_id}`
- System: `console.secrets.audit`, `console.realtime.subscription-lifecycle`, `console.quota.hard_limit.blocked`, `console.quota.soft_limit.exceeded`, `console.plan.capability.{enabled,disabled}`, `console.backup.scope.queried`, `quota.threshold.alerts`

### WebSocket (Realtime)

`wss://{publicHost}/v1/websockets`; Bearer JWT; subscription scoped by workspace; tenant isolation per session; topic-based subscriptions w/ filter expressions (`filter-evaluator.mjs`, `complexity-checker.mjs`).

### CLI

None identified; OpenWhisk actions are the primary function entry points.

## Data Stores

### PostgreSQL
- **Isolation strategy (inferred):** schema-per-tenant pattern (`CREATE SCHEMA tenant_*`) seen in `docs/reference/postgresql/tenant-isolation-baseline.sql`; shared `control` schema with RLS via `current_setting('app.tenant_id')` / `app.workspace_id`; policies `WHERE tenant_id = control.current_tenant_id() AND workspace_id = control.current_workspace_id()`.
- **Roles:** platform_runtime, platform_migrator, platform_provisioner, platform_audit_readonly, platform_break_glass.
- **Key tables:** `control.workspace_memberships` (RLS); per-tenant schema tables; `postgres_capture_configs`/`mongo_capture_configs`; `*_capture_audit_log`; provisioning saga state; `realtime_{scope_channel_mappings,subscription_auth_records,sessions}`; `webhook_{subscriptions,deliveries}`; scheduling job/exec/log tables; backup operations/snapshots/restore confirmations.

### MongoDB
Per-workspace/tenant collections; isolation via `services/adapters/src/{mongodb-data-api,mongodb-admin}.mjs`; CDC bridge publishes tenant-scoped changes.

### Kafka
Broker via `KAFKA_BROKERS`; topics namespaced by CDC prefix + tenant/workspace; secret-audit extended retention.

### S3
Backup snapshots for PITR (`services/backup-status/src/adapters/s3.adapter.ts`); storage event notifications can route to Kafka.

### Vault
Audit log tailed by secret-audit-handler (`src/vault-log-reader.mjs`); path `/vault/audit/vault-audit.log`.

### Keycloak
Realm-per-tenant IAM; clients per workspace; JWKS / introspection for JWT validation; user/scope/role admin via `services/adapters/src/keycloak-admin.mjs`.

## Tenant Context Resolution & Propagation

1. **Entry → identity:** Bearer token (header or query) → gateway validates `X-Correlation-Id`, `Idempotency-Key`, `X-API-Version` (`services/gateway-config/base/public-api-routing.yaml`) → `token-validator.mjs` decodes `kid`, verifies via JWKS (cached; introspection fallback), extracts `sub`, `tenant_id`, `scope`, `workspace_ids`.
2. **Context → app layer:** `SessionManager` stores claims in Postgres session keyed `(tenantId, workspaceId, actorIdentity)`; `tenant_id` claim → `tenantId` propagated downstream; `ScopeChecker` loads `realtime_scope_channel_mappings` scoped `(tenantId, workspaceId)`.
3. **Context → data layer:** Postgres `SET app.tenant_id=…` before queries (RLS enforces); webhooks/scheduling/backup queries filtered by `(tenant_id, workspace_id)`.
4. **Context → jobs/events:** scheduling audit events carry `tenantId, workspaceId, actorId`; CDC bridges read capture configs incl. tenant/workspace and log audit; secret-audit sanitizes Vault events.

## Background Jobs / Workers / Schedulers / Consumers

- **Scheduling engine (OpenWhisk):** `actions/{scheduling-job-runner,scheduling-management,scheduling-trigger}.mjs`; quota `src/quota.mjs` (`workspace.scheduling.jobs.max`, concurrency).
- **Provisioning orchestrator (OpenWhisk):** saga `src/saga/saga-engine.mjs`; appliers `src/appliers/*.mjs`; Postgres saga state.
- **Backup status (OpenWhisk):** `src/operations/{trigger-backup,trigger-restore,query-audit}.action.ts`, `restore-simulation.service.ts`.
- **CDC bridges:** `services/{pg,mongo}-cdc-bridge/src/index.mjs` (`ChangeStreamManager`).
- **Secret audit handler:** `services/secret-audit-handler/src/index.mjs` (`createLogTailer()`).

## Notable Cross-Cutting Concerns

- **AuthN/AuthZ:** JWT via jose + JWKS (cached, refresh on miss); introspection fallback; claims normalization; 5s clock tolerance; Postgres session store; scope-to-channel enforcement. Evidence `services/realtime-gateway/src/auth/*.mjs`.
- **Authorization/access:** RLS on shared tables; capability resolution in `internal-contracts` (`resolveTenant/WorkspaceEffectiveCapabilities()`); gateway routes gated on `plan.capabilityKeys` with denial audit events; Keycloak realm roles.
- **Quotas & rate limiting:** dimensions per tenant/workspace (`tenant.storage.bytes.max`, `workspace.scheduling.jobs.max`, `workspace.kafka_topics.max`); modes hard-blocked / soft-grace / soft-exhausted; hard-limit rejects + audit `quota.hard_limit_exceeded`; soft-limit Kafka alerts; usage snapshots.
- **Audit & observability:** pipeline subsystems → Kafka → persistence (query/export/correlation surfaces); audit event schema requires actor, scope_envelope {tenant_id, workspace_id}, resource, action, result, origin; metrics families, health checks, business metrics, threshold alerts, console dashboards. Evidence `services/internal-contracts/src/observability-*.json`.
- **Secrets:** Vault audit tailing; sanitization; secret consumer ack tracking + audit events.
- **SSRF hardening (webhook):** `normalizeNumericIPv4()` (inet_aton-style), `isBlockedIp()` covering 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, ::1, ::, fc00::/7, fe80::/10; re-checked at delivery time. Evidence `services/webhook-engine/src/webhook-subscription.mjs`.
- **Domain model & lifecycle:** `<prefix>_<ulid>` IDs (ten_*, wrk_*, usr_*); states draft/provisioning/active/suspended/soft_deleted; immutable correlated lifecycle events; commercial plans → capability keys + quota defaults + deployment profile; effective capability = plan ∩ deployment profile ∩ environment. Evidence `services/internal-contracts/src/domain-model.json`.

## Open Questions

1. control-plane execution model (placeholder package.json — spec artifact vs OpenWhisk actions vs separate app).
2. event-gateway execution role (Kafka consumer? HTTP adapter?).
3. External application OAuth2/PKCE client provisioning + token exchange completeness.
4. Backup encryption/PITR technical specifics (native AWS vs custom).
5. Workspace subdomain deployment mode (`OPTIONAL_WORKSPACE_SUBDOMAIN_TEMPLATE`).
6. schema-per-tenant vs shared-with-RLS actual placement strategy.
