# Functionalities — Falcone BaaS (source-derived)

> Concrete, testable behaviors grouped by capability. Evidence anchored to `path::symbol` or `file:line`.
> Generated: 2026-06-08

---

## cap-tenant-lifecycle

### fn-tenant-lifecycle-01
**Behavior:** Evaluate whether a lifecycle state transition (e.g., draft → provisioning, active → suspended) is allowed for a tenant given its current state, associated workspaces, managed resources, elevated-access flag, and optional second confirmation.
**Parent cap:** cap-tenant-lifecycle
**Entry point:** `apps/control-plane/src/tenant-management.mjs::previewTenantLifecycleMutation` → internal `evaluateTenantLifecycleMutation`
**Evidence:** `apps/control-plane/src/tenant-management.mjs:91-109`; `services/internal-contracts/src/domain-model.json` (business_state_machines, lifecycle_transitions)
**Edge cases:** Purge/delete requires `hasElevatedAccess=true` + `hasSecondConfirmation=true`; workspaces in wrong state block transitions
**Confidence:** high

### fn-tenant-lifecycle-02
**Behavior:** Build a purge-request draft for a tenant, requiring actor user ID, approval ticket reference, and a verbatim confirmation text.
**Parent cap:** cap-tenant-lifecycle
**Entry point:** `apps/control-plane/src/tenant-management.mjs::buildTenantPurgeRequestDraft`
**Evidence:** `apps/control-plane/src/tenant-management.mjs:111-113`
**Edge cases:** Empty `approvalTicket` or `confirmationText` produces a semantically incomplete draft (validation at consumer)
**Confidence:** high

### fn-tenant-lifecycle-03
**Behavior:** Produce a tenant resource inventory snapshot counting workspaces, external applications, service accounts, and managed resources by kind and state.
**Parent cap:** cap-tenant-lifecycle
**Entry point:** `apps/control-plane/src/tenant-management.mjs::previewTenantInventory` → `buildTenantResourceInventory`
**Evidence:** `services/internal-contracts/src/index.mjs::buildTenantResourceInventory:1320-1360`
**Edge cases:** Empty resource arrays → zero counts; shared resources counted separately (`sharingScope === 'tenant_shared'`)
**Confidence:** high

### fn-tenant-lifecycle-04
**Behavior:** Produce a full functional configuration export artifact for a tenant including sections: tenant, labels, quotas, governance, workspace/application/service-account/managed-resource inventories, redaction mode, and recovery artifacts.
**Parent cap:** cap-tenant-lifecycle
**Entry point:** `apps/control-plane/src/tenant-management.mjs::previewTenantFunctionalExport` → `buildTenantFunctionalConfigurationExport`
**Evidence:** `services/internal-contracts/src/index.mjs:1362-1406` (`includedSections` array, `recoveryArtifacts`)
**Edge cases:** `redactionMode` defaults to `'secret_references_only'`; missing `exportProfile` produces synthetic IDs
**Confidence:** high

### fn-tenant-lifecycle-05
**Behavior:** Summarize the tenant governance dashboard combining lifecycle state machine, API route catalog, and storage context introspection.
**Parent cap:** cap-tenant-lifecycle
**Entry point:** `apps/control-plane/src/tenant-management.mjs::summarizeTenantManagementSurface`
**Evidence:** `apps/control-plane/src/tenant-management.mjs:22-53`
**Edge cases:** `storageContext` null → dashboard omits storage section; context entity-type check ensures normalization
**Confidence:** high

---

## cap-tenant-provisioning

### fn-provisioning-01
**Behavior:** Execute a tenant provisioning saga that applies domain changes (IAM realm, Kafka topics/ACLs, Postgres schemas, MongoDB, storage namespace, OpenWhisk namespace) sequentially; each applier operates under `tenantId` scope and supports dry-run mode.
**Parent cap:** cap-tenant-provisioning
**Entry point:** `services/provisioning-orchestrator/src/appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs::apply(tenantId, domainData, options)`
**Evidence:** `services/provisioning-orchestrator/src/appliers/functions-applier.mjs:18-40`; appliers directory confirms 6 domains
**Edge cases:** Empty `domainData` returns `status: 'applied'` with zero counts; `dryRun=true` skips writes; per-domain error does not prevent other domains (saga partial-failure model)
**Confidence:** high

### fn-provisioning-02
**Behavior:** Enforce authorization context at provisioning request boundary — validates `tenant_id`, `workspace_id`, `plan_id`, `correlation_id`, `effective_roles`, `delegation_chain` are present; rejects requests with `cross_tenant_violation`.
**Parent cap:** cap-tenant-provisioning
**Entry point:** `services/provisioning-orchestrator/src/authorization-context.mjs::provisioningAuthorizationContextProjection`
**Evidence:** `services/provisioning-orchestrator/src/authorization-context.mjs:6-10`; `services/internal-contracts/src/authorization-model.json` (context_projection, negative_authorization_case)
**Edge cases:** Missing `correlation_id` → `missing_context` error class; delegation chain must be explicit (no implicit escalation)
**Confidence:** high

---

## cap-tenant-storage-context

### fn-storage-ctx-01
**Behavior:** Derive a deterministic tenant storage namespace from `tenantId` and optional `tenantSlug` using `sha256(providerType:tenantId:tenant-storage-context)[:12]` suffix.
**Parent cap:** cap-tenant-storage-context
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::deriveTenantStorageNamespace`
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:117-126`
**Edge cases:** Missing `tenantId` throws; `tenantSlug` slugified (lowercase, max 24 chars, non-alphanum → `-`)
**Confidence:** high

### fn-storage-ctx-02
**Behavior:** Build the tenant storage context record resolving capability availability (requires `data.storage.bucket` in plan), provider status, and tenant state; sets `state` to one of draft/provisioning/active/suspended/soft_deleted; `bucketProvisioningAllowed` requires all three: active state + capability + provider ready.
**Parent cap:** cap-tenant-storage-context
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageContextRecord`
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:150-260`; `normalizeProvisioningStatus` at line 81
**Edge cases:** `capabilityAvailable=false` → state=draft; `tenantState=suspended` → state=suspended + credential health=revoked; `tenantState=soft_deleted` → permanently_revoked
**Confidence:** high

### fn-storage-ctx-03
**Behavior:** Rotate the storage context credential by incrementing version, generating a new `secretRef` with a fresh sha256 suffix, and emitting a `tenant_storage_context.{transition}` event with audit envelope.
**Parent cap:** cap-tenant-storage-context
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::rotateTenantStorageContextCredential`
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:312-345`
**Edge cases:** Non-active context produces `normalizeCredentialHealth` health (not `'rotated'`); `actorUserId` and `reason` captured in provisioning block
**Confidence:** high

### fn-storage-ctx-04
**Behavior:** Preview workspace storage bootstrap: if tenant storage context is missing or not active, returns `requestedState: 'dependency_wait'` or `'blocked'` with a `reasonCode`; if active and `bucketProvisioningAllowed`, returns `requestedState: 'pending'` with namespace.
**Parent cap:** cap-tenant-storage-context
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::previewWorkspaceStorageBootstrap`
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:384-461`
**Edge cases:** `CAPABILITY_NOT_AVAILABLE` or `PROVIDER_BASELINE_UNSATISFIED` → `blocked`; `CONTEXT_SUSPENDED`/`CONTEXT_SOFT_DELETED` → `blocked`; missing context → `dependency_wait`
**Confidence:** high

---

## cap-workspace-lifecycle

### fn-workspace-lifecycle-01
**Behavior:** Build a workspace clone draft from a source workspace, carrying over configurable clone policy (applications, service accounts, managed resource bindings, metadata); sets `resourceInheritance` with mode `clone_workspace` and source reference.
**Parent cap:** cap-workspace-lifecycle
**Entry point:** `apps/control-plane/src/workspace-management.mjs::buildWorkspaceCloneDraft` → `services/internal-contracts/src/index.mjs::buildWorkspaceCloneDraft`
**Evidence:** `services/internal-contracts/src/index.mjs:1267-1300`
**Edge cases:** Missing `sourceWorkspace.workspaceId` throws; `resetCredentialReferences: true` by default (prevents credential leakage into clone)
**Confidence:** high

### fn-workspace-lifecycle-02
**Behavior:** Classify workspace logical resources as shared (tenant_shared) vs. specialized, producing `sharedResourceKeys` and `specializedResourceKeys` arrays; sets `requiresCloneLineage` for clone mode with source workspace.
**Parent cap:** cap-workspace-lifecycle
**Entry point:** `services/internal-contracts/src/index.mjs::resolveWorkspaceResourceInheritance`
**Evidence:** `services/internal-contracts/src/index.mjs:1241-1265`
**Edge cases:** `mode='tenant_defaults'` with no `sourceWorkspaceId` → `requiresCloneLineage=false`; mixed sharing scopes produce separate lists
**Confidence:** high

### fn-workspace-lifecycle-03
**Behavior:** Resolve the full API surface (URLs for control-api, console, identity, realtime endpoints) for a workspace given its slug, environment, and applications; optionally uses workspace-subdomain topology.
**Parent cap:** cap-workspace-lifecycle
**Entry point:** `services/internal-contracts/src/index.mjs::resolveWorkspaceApiSurface`
**Evidence:** `services/internal-contracts/src/index.mjs:1183-1239`
**Edge cases:** Unknown `workspaceEnvironment` throws; subdomain pattern only applied for `allowed_environments` in deployment-topology config
**Confidence:** high

---

## cap-auth-console

### fn-auth-01
**Behavior:** Console authentication via OIDC delegated flow; routes in `auth` family are `delegated_oidc` mode; supports public (no auth required) and protected routes.
**Parent cap:** cap-auth-console
**Entry point:** `apps/control-plane/src/console-auth.mjs::summarizeConsoleAuthSurface`; gateway `auth` family
**Evidence:** `apps/control-plane/src/console-auth.mjs:9-38`; `services/gateway-config/base/public-api-routing.yaml:248-259`
**Edge cases:** Status views include `account_suspended` and `credentials_expired` to surface blocked states to users
**Confidence:** high

### fn-auth-02
**Behavior:** Signup flow with pending-activation state; new users enter `pending_activation` until approved.
**Parent cap:** cap-auth-console
**Entry point:** `apps/control-plane/src/console-auth.mjs::CONSOLE_AUTH_STATUS_VIEWS` includes `'pending_activation'`; `GET /v1/auth/signups/policy`
**Evidence:** `apps/control-plane/src/console-auth.mjs:9-16`
**Edge cases:** Signup policy route controls open vs. invite-only registration
**Confidence:** medium (status view confirmed; policy enforcement path ⚠ not fully code-verified)

---

## cap-iam-admin

### fn-iam-01
**Behavior:** Full CRUD (list, get, create, update, delete, activate, deactivate, reset_credentials) on Keycloak realm resources per tenant; realm IDs `master` and `in-falcone-platform` are reserved and blocked from mutation.
**Parent cap:** cap-iam-admin
**Entry point:** `GET/POST/PUT/DELETE /v1/admin/iam/realms/*`
**Evidence:** `services/adapters/src/keycloak-admin.mjs::RESERVED_REALM_IDS` — `['master','in-falcone-platform']`; `IAM_ADMIN_ACTIONS`
**Edge cases:** Attempt to delete/update reserved realm → rejected; only Keycloak 24.x–26.x supported
**Confidence:** high

### fn-iam-02
**Behavior:** CRUD on Keycloak clients (OIDC/SAML) per tenant realm; reserved role names (14 platform/tenant/workspace roles) and reserved scope names (openid, profile, email, roles, web-origins) blocked from mutation.
**Parent cap:** cap-iam-admin
**Entry point:** `GET/POST/PUT/DELETE /v1/admin/iam/clients/*`
**Evidence:** `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (14 entries); `RESERVED_SCOPE_NAMES`; `SUPPORTED_CLIENT_PROTOCOLS: ['openid-connect','saml']`
**Edge cases:** Non-OIDC/SAML protocol → rejected; credential reset requires `reset_credentials` action in capability matrix
**Confidence:** high

### fn-iam-03
**Behavior:** IAM family routes gated by `identity.sso.oidc` plan capability; tenants on plans without this capability receive 403/capability-denied when accessing IAM admin routes.
**Parent cap:** cap-iam-admin
**Entry point:** Gateway `iam` family, `planCapabilityAnyOf: [identity.sso.oidc]`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:262-275`
**Edge cases:** Tenant on starter plan without SSO capability blocked at gateway; audit event emitted on denial
**Confidence:** high

---

## cap-token-validation

### fn-token-01
**Behavior:** Validate a Bearer JWT by decoding the `kid` header, fetching the JWKS signing key (cached for `JWKS_CACHE_TTL_SECONDS`), verifying signature with `jwtVerify` (5 s clock tolerance), and normalizing claims (`sub`, `tenant_id`, `scopes`, `authorizedWorkspaces`, `exp`, `jti`).
**Parent cap:** cap-token-validation
**Entry point:** `services/realtime-gateway/src/auth/token-validator.mjs::validateToken`
**Evidence:** `services/realtime-gateway/src/auth/token-validator.mjs:95-190`; `normalizeClaims:64-74`
**Edge cases:** Missing `kid` → `TOKEN_INVALID`; expired token → `TOKEN_EXPIRED`; unknown `kid` triggers JWKS refresh before introspection fallback
**Confidence:** high

### fn-token-02
**Behavior:** On unknown-kid error after JWKS refresh, fall back to Keycloak token introspection; if introspection returns `active: false`, throw `TOKEN_REVOKED`.
**Parent cap:** cap-token-validation
**Entry point:** `services/realtime-gateway/src/auth/token-validator.mjs::introspectToken`
**Evidence:** `services/realtime-gateway/src/auth/token-validator.mjs:127-151`
**Edge cases:** Introspection endpoint non-200 → `TOKEN_INVALID`; `active: false` → `TOKEN_REVOKED`
**Confidence:** high

### fn-token-03
**Behavior:** TEST_MODE in backup-status validates JWT by base64-decoding payload only (no cryptographic verification); TEST_MODE is blocked when `NODE_ENV=production`, throwing HTTP 500.
**Parent cap:** cap-token-validation
**Entry point:** `services/backup-status/src/api/backup-status.auth.js::validateToken:45-67`
**Evidence:** `services/backup-status/src/api/backup-status.auth.js:45-67`
**Edge cases:** `NODE_ENV=production && TEST_MODE=true` → 500 mis-configuration guard; test tokens never reach production validation path
**Confidence:** high

---

## cap-external-apps-service-accounts

### fn-extapp-01
**Behavior:** Validate external application configuration: redirect URIs must be HTTPS (HTTP only allowed for localhost in dev mode); duplicate URIs rejected; missing required URIs when `allowEmpty=false` rejected.
**Parent cap:** cap-external-apps-service-accounts
**Entry point:** `apps/control-plane/src/external-application-iam.mjs::pushUriValidation`
**Evidence:** `apps/control-plane/src/external-application-iam.mjs:15-30` (`isLikelyHttpsUri`); `:47-65` (`pushUriValidation`)
**Edge cases:** Non-HTTPS production URI → `error` severity violation; PEM certificate validation via regex guard
**Confidence:** high

### fn-extapp-02
**Behavior:** Enforce per-plan application count limits; read from `external_application_plan_limits` governance catalog using `planId`.
**Parent cap:** cap-external-apps-service-accounts
**Entry point:** `services/internal-contracts/src/index.mjs::getExternalApplicationPlanLimit`; `apps/control-plane/src/external-application-iam.mjs::getLimitValue`
**Evidence:** `apps/control-plane/src/external-application-iam.mjs:39-41`; `services/internal-contracts/src/index.mjs:1051-1057`
**Edge cases:** Unknown `planId` → `getExternalApplicationPlanLimit` returns undefined → no limit applied (⚠ permissive default)
**Confidence:** medium

---

## cap-tenant-isolation

### fn-isolation-01
**Behavior:** On realtime event publish, verify that `event.tenantId === session.tenantId` AND `event.workspaceId === session.workspaceId`; reject (return false) for any cross-tenant or cross-workspace event.
**Parent cap:** cap-tenant-isolation
**Entry point:** `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs::guardEvent`
**Evidence:** `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs:1-4`
**Edge cases:** Null/undefined `tenantId` on either side → strict equality fails → event blocked
**Confidence:** high

### fn-isolation-02
**Behavior:** CDC Kafka topic names always embed `{tenantId}.{workspaceId}` as non-replaceable components; an optional prefix namespace is validated against `NAMESPACE_RE` (`^[a-z][a-z0-9._-]{0,63}$`) and rejected on violation.
**Parent cap:** cap-tenant-isolation
**Entry point:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic`; `assertValidTopicNamespace`
**Evidence:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:26-29`; `assertValidTopicNamespace:11-16`
**Edge cases:** Empty `namespace` → bare `{tenantId}.{workspaceId}.pg-changes`; invalid namespace at startup → `Error` thrown (process abort)
**Confidence:** high

### fn-isolation-03
**Behavior:** Webhook subscription table indexed on `(tenant_id, workspace_id)`; all delivery records carry `tenant_id` + `workspace_id`; queries must supply both to access subscription data.
**Parent cap:** cap-tenant-isolation
**Entry point:** `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17,43`
**Evidence:** `services/webhook-engine/migrations/001-webhook-subscriptions.sql:1-53`
**Edge cases:** Missing tenant/workspace in query → no rows returned (index enforces scoping); soft-delete via `deleted_at IS NULL` filter
**Confidence:** high

### fn-isolation-04
**Behavior:** Scheduling job queries always filter by `(tenant_id, workspace_id)` — quota count, config lookup, job CRUD; cross-tenant access to scheduling data not possible via the service API.
**Parent cap:** cap-tenant-isolation
**Entry point:** `services/scheduling-engine/src/quota.mjs::getActiveJobCount`; `src/config-model.mjs::getConfig`
**Evidence:** `services/scheduling-engine/src/quota.mjs:21-29` (`WHERE tenant_id=$1 AND workspace_id=$2`); `src/config-model.mjs:5-14`
**Edge cases:** Config waterfall: workspace-level → tenant-level → env defaults; workspace_id IS NULL for tenant-level config
**Confidence:** high

### fn-isolation-05
**Behavior:** MongoDB CDC bridge audit log always records `tenant_id`, `workspace_id`, and `actor_identity` for every lifecycle event on a capture config.
**Parent cap:** cap-tenant-isolation
**Entry point:** `services/mongo-cdc-bridge/src/index.mjs:30` (auditCallback)
**Evidence:** `INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, after_state)` — line 30
**Edge cases:** Null `config.actor_identity` stored as null; `after_state` is JSONB — supports structured change detail
**Confidence:** high

---

## cap-context-propagation

### fn-ctx-01
**Behavior:** Gateway propagates `X-Tenant-Id`, `X-Workspace-Id`, `X-Plan-Id`, `X-Auth-Scopes`, `X-Actor-Roles`, `X-Auth-Subject`, `X-Actor-Username` headers to all upstream services on every authenticated request; spoofed context headers in inbound requests are rejected.
**Parent cap:** cap-context-propagation
**Entry point:** `services/gateway-config/base/public-api-routing.yaml` — `propagatedHeaders`, `rejectSpoofedContextHeaders: true`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:210-218` (YAML anchor `&a1`); all family entries reference the anchor
**Edge cases:** Internal requests must carry `X-Gateway-Managed-Route` + `X-Internal-Request-Mode` + `X-Internal-Request-Timestamp` for `validated_attestation` mode
**Confidence:** high

### fn-ctx-02
**Behavior:** For all mutation requests (POST/PUT/PATCH/DELETE) the gateway requires an `Idempotency-Key` header; requests are deduplicated for 86400 s based on `sha256(body)`; replayed responses carry `X-Idempotency-Replayed: true`.
**Parent cap:** cap-context-propagation
**Entry point:** `services/gateway-config/base/public-api-routing.yaml::idempotencyHeader`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:20-28`
**Edge cases:** `requireIdempotencyHeaderOnMutations: false` for `observability` and `native_admin` profiles; missing key on applicable routes → 400
**Confidence:** high

---

## cap-postgres-data-api

### fn-pg-01
**Behavior:** Resolve the Postgres admin profile for a workspace: determines placement mode (shared/dedicated), allowed extension list, table-security/policy/grant/extension mutation flags, and admin SQL enablement per plan.
**Parent cap:** cap-postgres-data-api
**Entry point:** `apps/control-plane/src/postgres-admin.mjs::getPostgresCompatibilitySummary`
**Evidence:** `apps/control-plane/src/postgres-admin.mjs:73-104`; `services/adapters/src/postgresql-admin.mjs::resolvePostgresAdminProfile`
**Edge cases:** Admin SQL disabled by default; `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES` restricts which roles may execute admin SQL
**Confidence:** high

### fn-pg-02
**Behavior:** Admin SQL execution routes (`/v1/workspaces/*/sql*`, `/v1/workspaces/*/admin/sql*`) are blocked at the gateway unless the tenant has the `sql_admin_api` capability in their plan.
**Parent cap:** cap-postgres-data-api
**Entry point:** `services/gateway-config/routes/capability-gated-routes.yaml` — `sql_admin_api`
**Evidence:** `services/gateway-config/routes/capability-gated-routes.yaml:29-35`
**Edge cases:** Missing capability → 403 from gateway capability-gate plugin; audit denial event emitted
**Confidence:** high

---

## cap-pg-cdc

### fn-pg-cdc-01
**Behavior:** Start one WAL listener per active `(data_source_ref, tenant_id)` pair in `pg_capture_configs`; on reconnect failure, apply exponential backoff (initial 1 s, max 60 s).
**Parent cap:** cap-pg-cdc
**Entry point:** `services/pg-cdc-bridge/src/WalListenerManager.mjs::start`
**Evidence:** `services/pg-cdc-bridge/src/WalListenerManager.mjs:20-26`; `_scheduleReconnect:26`
**Edge cases:** No active capture configs → no listeners started; listener tied to `tenant_id` to scope config cache reads
**Confidence:** high

### fn-pg-cdc-02
**Behavior:** Rate-limit CDC event publishing per workspace to `PG_CDC_MAX_EVENTS_PER_SECOND` (default 1000) using a per-workspace sliding 1-second window; rate-limited events are dropped and metrics incremented.
**Parent cap:** cap-pg-cdc
**Entry point:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow`
**Evidence:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:34` — `_allow(workspaceId)` checks rolling window; drops and emits `rate-limited` event on exceed
**Edge cases:** Rate-limited events are permanently dropped (no retry queue); metrics `pg_cdc_events_rate_limited_total` incremented
**Confidence:** high

### fn-pg-cdc-03
**Behavior:** Publish Kafka CDC message with CloudEvents headers: `ce-type: console.pg-capture.change`, `ce-tenantid: {tenantId}`, `ce-workspaceid: {workspaceId}`, `ce-source: /data-sources/{ref}/tables/{schema}.{table}`.
**Parent cap:** cap-pg-cdc
**Entry point:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish`
**Evidence:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:40` — headers block
**Edge cases:** Idempotent producer (`acks: -1`); publish lag metric `pg_cdc_publish_lag_seconds` set per workspace+table
**Confidence:** high

---

## cap-mongo-data-api

### fn-mongo-01
**Behavior:** Manage MongoDB capture configs per workspace; on status error, update `mongo_capture_configs.status` and `last_error`; record lifecycle events in `mongo_capture_audit_log`.
**Parent cap:** cap-mongo-data-api
**Entry point:** `services/mongo-cdc-bridge/src/index.mjs::statusUpdater`; `auditCallback`
**Evidence:** `services/mongo-cdc-bridge/src/index.mjs:29-30`
**Edge cases:** `after_state` stored as JSONB; null detail stored as null JSON
**Confidence:** high

---

## cap-mongo-cdc

### fn-mongo-cdc-01
**Behavior:** Manage MongoDB change streams with resume-token durability: persist resume tokens in Postgres `ResumeTokenStore`; on restart, resume from last known token to avoid event loss.
**Parent cap:** cap-mongo-cdc
**Entry point:** `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs` (via `ResumeTokenStore`)
**Evidence:** `services/mongo-cdc-bridge/src/index.mjs:23` — `ResumeTokenStore` injected into `ChangeStreamManager`
**Edge cases:** Missing resume token → stream starts from current oplog position (potential gap); token stored per `captureId`
**Confidence:** medium (ResumeTokenStore integration confirmed; internal implementation not directly read)

---

## cap-storage

### fn-storage-01
**Behavior:** Bucket creation is blocked unless `bucketProvisioningAllowed=true`, which requires: tenant storage context `state=active`, `capabilityAvailable=true` (`data.storage.bucket`), and `providerStatus=ready` with baseline satisfied.
**Parent cap:** cap-storage
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageContextRecord` — `bucketProvisioningAllowed` field
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:229`
**Edge cases:** Suspended tenant → `bucketProvisioningAllowed=false`; provider unavailable → retryable_failure; capability unavailable → blocked (non-retryable)
**Confidence:** high

### fn-storage-02
**Behavior:** Enforce storage quota: `tenant.storage.bytes.max` and `tenant.storage.buckets.max` read from quota policy; defaults: 10 GiB bytes / 8 buckets when not set in plan.
**Parent cap:** cap-storage
**Entry point:** `services/adapters/src/storage-tenant-context.mjs::buildTenantStorageQuotaAssignment`
**Evidence:** `services/adapters/src/storage-tenant-context.mjs:128-148`; `DEFAULT_STORAGE_CAPACITY_BYTES = 10*1024*1024*1024`, `DEFAULT_STORAGE_BUCKET_LIMIT = 8`
**Edge cases:** Quota from `governance_catalog` takes precedence; null limit from quota policy triggers default
**Confidence:** high

### fn-storage-03
**Behavior:** Issue, rotate, and revoke programmatic storage credentials (S3-compatible key pairs); rotated credential produces new version; revoked credential becomes permanently inactive; credential values never returned after initial issuance.
**Parent cap:** cap-storage
**Entry point:** `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialSecretEnvelope`; `rotateStorageProgrammaticCredential`; `revokeStorageProgrammaticCredential`
**Evidence:** `apps/control-plane/src/storage-admin.mjs::issueStorageProgrammaticCredentialPreview`; `rotateStorageProgrammaticCredentialPreview`; `revokeStorageProgrammaticCredentialPreview`
**Edge cases:** States: STORAGE_PROGRAMMATIC_CREDENTIAL_STATES catalog; revoked credentials cannot be re-activated
**Confidence:** high

### fn-storage-04
**Behavior:** Import/export storage bucket objects with manifest; enforces platform-level and optional tenant-override operation limit on object count; conflict policies applied per entry; partial failures produce `partial_failure` outcome.
**Parent cap:** cap-storage
**Entry point:** `apps/control-plane/src/storage-admin.mjs::previewStorageExportManifest`; `previewStorageImportResult`
**Evidence:** `apps/control-plane/src/storage-admin.mjs:475-539`; `checkImportExportOperationLimit` checks `objectCount > appliedLimit`
**Edge cases:** `objectCount=0` → `export_empty_result` outcome; `failedCount>0 && importedCount>0` → `partial_failure`; limit exceeded → `OPERATION_LIMIT_EXCEEDED` error
**Confidence:** high

### fn-storage-05
**Behavior:** Detect storage usage threshold breaches at bucket/workspace/tenant scope; rank buckets by usage dimension; emit audit events on usage access.
**Parent cap:** cap-storage
**Entry point:** `apps/control-plane/src/storage-admin.mjs::previewWorkspaceStorageUsage`; `previewTenantStorageUsage`; `rankWorkspaceBucketsByUsage`
**Evidence:** `apps/control-plane/src/storage-admin.mjs:556-693`; `detectStorageUsageThresholdBreaches`; `rankBucketsByUsage`
**Edge cases:** Cross-tenant storage usage (`previewCrossTenantStorageUsage`) available for platform-admin scope only
**Confidence:** high

---

## cap-realtime

### fn-realtime-01
**Behavior:** Create a realtime WebSocket session: validate Bearer JWT → check scopes against `realtime_scope_channel_mappings` (tenant+workspace scoped) → insert `realtime_sessions` row → start periodic re-validation polling.
**Parent cap:** cap-realtime
**Entry point:** `services/realtime-gateway/src/auth/session-manager.mjs::createSession`
**Evidence:** `services/realtime-gateway/src/auth/session-manager.mjs:145-183`
**Edge cases:** Missing `tenant_id` in claims → `allowed: false, missingScope: 'tenant_id'`; workspace not in `authorizedWorkspaces` → `allowed: false, missingScope: 'workspace-access'`; no scope mappings → fallback to `realtime:read` scope requirement
**Confidence:** high

### fn-realtime-02
**Behavior:** Periodically re-introspect the token and re-check scopes at `SCOPE_REVALIDATION_INTERVAL_SECONDS`; suspend session with reason `TOKEN_EXPIRED`, `SCOPE_REVOKED` on failure; publish `SUSPENDED` audit event to Kafka.
**Parent cap:** cap-realtime
**Entry point:** `services/realtime-gateway/src/auth/session-manager.mjs::startPolling`
**Evidence:** `services/realtime-gateway/src/auth/session-manager.mjs:91-143`; `suspendSession:62-82` publishes `SUSPENDED` action
**Edge cases:** Token expiry grace period (`TOKEN_EXPIRY_GRACE_SECONDS`) allows brief clock skew; CLOSED session clears timer without re-publishing
**Confidence:** high

### fn-realtime-03
**Behavior:** Resume a suspended session by presenting a new Bearer token; re-validates token, restarts polling, and publishes `RESUMED` audit event to Kafka.
**Parent cap:** cap-realtime
**Entry point:** `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken`
**Evidence:** `services/realtime-gateway/src/auth/session-manager.mjs:185-232`
**Edge cases:** Unknown `sessionId` throws `Error`; prior status must be `SUSPENDED` to emit `RESUMED` (no event for active refresh)
**Confidence:** high

### fn-realtime-04
**Behavior:** Evaluate subscription filter expressions against events using predicates (eq, neq, contains); filter applies on `data`, `payload`, `after`, or top-level event fields; enforce filter complexity limits before subscribing.
**Parent cap:** cap-realtime
**Entry point:** `services/realtime-gateway/src/filters/filter-evaluator.mjs::evaluateFilter`; `complexity-checker.mjs`
**Evidence:** `services/realtime-gateway/src/filters/filter-evaluator.mjs:40-54`; complexity-checker file confirmed present
**Edge cases:** `filterSpec.passAll=true` → always passes; unknown `op` → returns `false` (deny on unknown operator)
**Confidence:** high

### fn-realtime-05
**Behavior:** Scope mapping cache per `(tenantId, workspaceId)` with TTL of `SCOPE_REVALIDATION_INTERVAL_SECONDS`; stale cache entries are refreshed from `realtime_scope_channel_mappings` table.
**Parent cap:** cap-realtime
**Entry point:** `services/realtime-gateway/src/auth/scope-checker.mjs::loadMappings`
**Evidence:** `services/realtime-gateway/src/auth/scope-checker.mjs:30-44`
**Edge cases:** Cache key is `{tenantId}:{workspaceId}` — cross-tenant scope leak impossible; expired cache re-fetches from DB
**Confidence:** high

---

## cap-events

### fn-events-01
**Behavior:** Publish events to workspace-scoped Kafka topics via gateway; accepts `application/json` and `application/cloudevents+json` content types; rate-limited at 180 req/min burst 60.
**Parent cap:** cap-events
**Entry point:** `POST /v1/events/topics/{resourceId}/publish` (operationId: `publishEvent`)
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:116-122` (event_gateway validation profile allows `application/cloudevents+json`); QoS profile `event_gateway`
**Edge cases:** Events family requires `data.kafka.topics` plan capability; missing capability → 403 at gateway
**Confidence:** high

### fn-events-02
**Behavior:** Manage Kafka topic ACLs per workspace; topic isolation enforced via naming policy; `kafka_topics.max` quota dimension limits topic count.
**Parent cap:** cap-events
**Entry point:** `apps/control-plane/src/events-admin.mjs::KAFKA_ADMIN_RESOURCE_KINDS` includes `topic_acl`
**Evidence:** `apps/control-plane/src/events-admin.mjs:9-13` (`KAFKA_ADMIN_RESOURCE_KINDS`); audit context fields include `target_tenant_id`, `target_workspace_id`
**Edge cases:** Quota `workspace.kafka_topics.max` enforced by hard-limit enforcement (audit `quota.hard_limit_exceeded`)
**Confidence:** high

### fn-events-03
**Behavior:** Event bridge: create bridges from external event sources to workspace topics; supports multiple source types and delivery modes.
**Parent cap:** cap-events
**Entry point:** `apps/control-plane/src/events-admin.mjs::summarizeEventBridgeSupport`
**Evidence:** `apps/control-plane/src/events-admin.mjs:129-143`; `EVENT_BRIDGE_SOURCE_TYPES` from `event-gateway/src/kafka-integrations.mjs`
**Edge cases:** ⚠ Event bridge source type validation and delivery mode details not directly read — referenced via imports
**Confidence:** medium

---

## cap-functions

### fn-functions-01
**Behavior:** Deploy a serverless function action with version tracking; versions are immutable; rollback restores a previous version while preserving the full version history.
**Parent cap:** cap-functions
**Entry point:** `GET/POST /v1/functions/{functionId}/versions`; `POST /v1/functions/{functionId}/rollback`
**Evidence:** `apps/control-plane/src/functions-admin.mjs::summarizeFunctionsAdminSurface` — `version` and `rollback` resource kinds confirmed; `lifecycleGovernance.immutableVersions: true, rollbackPreservesHistory: true`
**Edge cases:** Rollback emits `emitRollbackEvidenceEvent`; audit event includes version delta
**Confidence:** high

### fn-functions-02
**Behavior:** Invoke a function synchronously or asynchronously; console-backend invocations carry `tenantId`, `workspaceId`, `correlationId` in the activation annotation; `responseMode` and `triggerContext.kind='direct'` are required for console-backend envelope.
**Parent cap:** cap-functions
**Entry point:** `apps/control-plane/src/functions-admin.mjs::buildConsoleBackendInvocationEnvelope`; `POST /v1/functions/{functionId}/invoke`
**Evidence:** `apps/control-plane/src/functions-admin.mjs:244-286`; `validateConsoleBackendInvocationRequest` called before envelope build
**Edge cases:** Missing `responseMode` or `tenantId` or `workspaceId` throws; `triggerContext.kind !== 'direct'` throws; capability gate `functions_public` required for public invocations
**Confidence:** high

### fn-functions-03
**Behavior:** Manage workspace secrets as named references; secret values are write-only and never returned in API responses; isolation boundary is `tenant_plus_workspace`; functions bind to secrets by name only.
**Parent cap:** cap-functions
**Entry point:** `GET/POST/PUT/DELETE /v1/functions/*/workspace-secrets`
**Evidence:** `apps/control-plane/src/functions-admin.mjs::getOpenWhiskCompatibilitySummary` — `secretGovernance.valueDisclosure: 'never_returned'`, `isolationBoundary: 'tenant_plus_workspace'`; `FUNCTION_SECRET_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/`
**Edge cases:** Secret name must match pattern (lowercase, no consecutive hyphens); value disclosure policy is a contract guarantee
**Confidence:** high

### fn-functions-04
**Behavior:** Enforce function quota dimensions (function_count, invocation_count, compute_time_ms, memory_mb) at tenant and workspace scopes; quota hard-limit emits enforcement audit event.
**Parent cap:** cap-functions
**Entry point:** `GET /v1/functions/*/quota` → `apps/control-plane/src/functions-admin.mjs::emitQuotaEnforcementEvent`
**Evidence:** `apps/control-plane/src/functions-admin.mjs::getOpenWhiskCompatibilitySummary` — `quotaSupport.dimensions: ['function_count','invocation_count','compute_time_ms','memory_mb']`; `emitQuotaEnforcementEvent` exported
**Edge cases:** Hard-limit quota exceeded → write rejected + `quota.hard_limit_exceeded` audit event; soft-limit → Kafka alert
**Confidence:** high

### fn-functions-05
**Behavior:** Create cron and Kafka-topic triggers for functions; cron triggers integrate with scheduling-engine; Kafka triggers receive events from workspace topics.
**Parent cap:** cap-functions
**Entry point:** `POST /v1/functions/{functionId}/cron-trigger`; `POST /v1/functions/{functionId}/kafka-trigger`
**Evidence:** `apps/control-plane/src/functions-admin.mjs::SUPPORTED_FUNCTION_TRIGGER_KINDS`; `summarizeFunctionsAdminSurface` — `cron_trigger` and `kafka_trigger` resource kinds
**Edge cases:** Storage triggers also supported; trigger creation subject to function quota enforcement
**Confidence:** high

### fn-functions-06
**Behavior:** Import/export function definitions (actions, packages, triggers, rules) with scope-validated bundles; import validates bundle structure; export redacts credential references.
**Parent cap:** cap-functions
**Entry point:** `POST /v1/functions/import`; `GET /v1/functions/export`
**Evidence:** `apps/control-plane/src/functions-admin.mjs::buildScopeValidatedExportRequest`; `buildScopeValidatedImportRequest`; `validateImportBundle`; `IMPORT_ERROR_CODES`
**Edge cases:** `WEB_ACTION_VISIBILITY_STATES` governs exposure visibility; invalid bundle → `IMPORT_ERROR_CODES` response
**Confidence:** high

---

## cap-webhooks

### fn-webhooks-01
**Behavior:** Validate a new webhook subscription: parse target URL (must be `https:`), detect IP literals (all numeric encodings including octal/hex/2-part/1-part), check against blocklist, or resolve DNS hostname (fail-closed if resolution fails or any address is blocked); validate event types against catalogue.
**Parent cap:** cap-webhooks
**Entry point:** `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput`
**Evidence:** `services/webhook-engine/src/webhook-subscription.mjs:154-213`; `normalizeNumericIPv4:22-68`; `isBlockedIp:91-120`
**Edge cases:** `http:` protocol → `INVALID_URL`; DNS resolves to zero addresses → `INVALID_URL`; IPv4-mapped IPv6 (`::ffff:10.0.0.1`) → blocked; `0x7f000001` (loopback hex) → blocked; unknown event types → `INVALID_EVENT_TYPES`
**Confidence:** high

### fn-webhooks-02
**Behavior:** Build a subscription record with `tenant_id`, `workspace_id`, `created_by`, status `active`, and configured `max_consecutive_failures` (default 5); assign subscription ID via `crypto.randomUUID()`.
**Parent cap:** cap-webhooks
**Entry point:** `services/webhook-engine/src/webhook-subscription.mjs::buildSubscriptionRecord`
**Evidence:** `services/webhook-engine/src/webhook-subscription.mjs:216-235`
**Edge cases:** `context.maxConsecutiveFailures` overrides default; metadata stored as JSONB `{}`
**Confidence:** high

### fn-webhooks-03
**Behavior:** Apply subscription status transitions (active → paused/disabled/deleted; paused → active/deleted; disabled → active/deleted); invalid transitions throw `INVALID_STATUS_TRANSITION`; `deleted` is terminal.
**Parent cap:** cap-webhooks
**Entry point:** `services/webhook-engine/src/webhook-subscription.mjs::canTransition`; `applyStatusTransition`; `softDelete`
**Evidence:** `services/webhook-engine/src/webhook-subscription.mjs:237-259`; `TRANSITIONS` map
**Edge cases:** `softDelete` sets `deleted_at` timestamp in addition to `status=deleted`; active → active is not a valid transition (not in set)
**Confidence:** high

### fn-webhooks-04
**Behavior:** Store webhook delivery attempts in `webhook_delivery_attempts` with `attempt_num`, `http_status`, `response_ms`, `error_detail`, `outcome`; max attempts configurable per delivery record.
**Parent cap:** cap-webhooks
**Entry point:** `services/webhook-engine/migrations/001-webhook-subscriptions.sql:54-65`
**Evidence:** Schema `webhook_delivery_attempts` with `UNIQUE (subscription_id, event_id)` on `webhook_deliveries`
**Edge cases:** Duplicate `(subscription_id, event_id)` → idempotent delivery; pending deliveries indexed on `(status, next_attempt_at)` for efficient scheduling
**Confidence:** high

---

## cap-scheduling

### fn-scheduling-01
**Behavior:** Enforce job creation quota: count active jobs for `(tenantId, workspaceId)`; reject if `currentActiveCount >= maxActiveJobs`.
**Parent cap:** cap-scheduling
**Entry point:** `services/scheduling-engine/src/quota.mjs::checkJobCreationQuota`; `getActiveJobCount`
**Evidence:** `services/scheduling-engine/src/quota.mjs:3-30`
**Edge cases:** `checkResumeQuota` delegates to `checkJobCreationQuota` — same limit applies on resume; quota check is synchronous against live DB count
**Confidence:** high

### fn-scheduling-02
**Behavior:** Increment consecutive failure count on each job execution failure; automatically transition job to `errored` status when `consecutive_failure_count >= max_consecutive_failures`.
**Parent cap:** cap-scheduling
**Entry point:** `services/scheduling-engine/src/job-model.mjs::incrementFailureCount`
**Evidence:** `services/scheduling-engine/src/job-model.mjs:49-58`
**Edge cases:** `resetFailureCount` restores to 0 on success; `errored` job can only transition to `deleted` (not back to active)
**Confidence:** high

### fn-scheduling-03
**Behavior:** Apply valid job status transitions: active → paused/errored/deleted; paused → active/deleted; errored → deleted; invalid transitions throw an error.
**Parent cap:** cap-scheduling
**Entry point:** `services/scheduling-engine/src/job-model.mjs::canTransition`; `applyTransition`
**Evidence:** `services/scheduling-engine/src/job-model.mjs:4-47`; `VALID_TRANSITIONS` map
**Edge cases:** `deleted` is a terminal state (empty set); `applyTransition` sets `deleted_at` on `deleted` status
**Confidence:** high

### fn-scheduling-04
**Behavior:** Resolve scheduling configuration in waterfall order: workspace-specific config → tenant-level config (workspaceId IS NULL) → environment-variable defaults.
**Parent cap:** cap-scheduling
**Entry point:** `services/scheduling-engine/src/config-model.mjs::getConfig`
**Evidence:** `services/scheduling-engine/src/config-model.mjs:3-28`
**Edge cases:** `scheduling_enabled=false` (default) blocks all job creation unless overridden; `upsertConfig` uses `ON CONFLICT (tenant_id, workspace_id)` for idempotent updates
**Confidence:** high

### fn-scheduling-05
**Behavior:** Enforce minimum cron interval (`min_interval_seconds`, default 60 s) via `assertCronFloor`; cron expressions producing runs more frequent than the minimum are rejected.
**Parent cap:** cap-scheduling
**Entry point:** `services/scheduling-engine/src/quota.mjs::assertCronFloor` → `cron-validator.mjs::assertAboveFloor`
**Evidence:** `services/scheduling-engine/src/quota.mjs:15-17`; `cron-validator.mjs` referenced
**Edge cases:** `SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS` env override; expressions targeting sub-minute frequency always fail when default applies
**Confidence:** high

---

## cap-backup-restore

### fn-backup-01
**Behavior:** Trigger an on-demand backup for `(tenant_id, component_type, instance_id)`; verify no concurrent active operation exists; dispatch async; return 202 with `operation_id`; emit `backup.requested` audit event.
**Parent cap:** cap-backup-restore
**Entry point:** `services/backup-status/src/operations/trigger-backup.action.ts::main`
**Evidence:** `services/backup-status/src/operations/trigger-backup.action.ts:46-175`; `repo.findActive` checked at line 116; `dispatcher.dispatch` at line 147
**Edge cases:** Concurrent operation → 409 with `conflict_operation_id`; adapter does not support backup → 422 `adapter_capability_not_supported`; `BACKUP_ENABLED=false` → 501
**Confidence:** high

### fn-backup-02
**Behavior:** Enforce cross-tenant scope: `backup:write:own` scope restricts actor to operate only on their own `tenant_id`; `backup:write:global` (SRE) allows cross-tenant operations.
**Parent cap:** cap-backup-restore
**Entry point:** `services/backup-status/src/operations/trigger-backup.action.ts:97-99`
**Evidence:** `services/backup-status/src/operations/trigger-backup.action.ts:97` — `if (!hasWriteGlobal && token.tenantId !== tenant_id) → 403`; emits `cross_tenant_not_allowed` rejection audit event
**Edge cases:** Actor with only `backup:write:own` targeting another tenant's data → 403 + audit; role assigned as `tenant_owner` vs. `sre`
**Confidence:** high

### fn-backup-03
**Behavior:** Emit rejection audit events (`backup.rejected`) with structured reason codes (`cross_tenant_not_allowed`, `adapter_capability_not_supported`, `backup_not_enabled_in_deployment`, `operation_already_active`) for all denied backup attempts.
**Parent cap:** cap-backup-restore
**Entry point:** `services/backup-status/src/operations/trigger-backup.action.ts::emitRejection`
**Evidence:** `services/backup-status/src/operations/trigger-backup.action.ts:79-94`; `emitAuditEvent` called with `result: 'rejected'` and `rejectionReason`
**Edge cases:** Audit events are fire-and-forget (`void`); failure to emit audit does not block the rejection response
**Confidence:** high

---

## cap-secrets

### fn-secrets-01
**Behavior:** Tail Vault audit log file continuously; sanitize sensitive fields from each entry; publish cleaned event to `console.secrets.audit` Kafka topic.
**Parent cap:** cap-secrets
**Entry point:** `services/secret-audit-handler/src/index.mjs`
**Evidence:** `services/secret-audit-handler/src/index.mjs:31-34` — `for await (const entry of createLogTailer(filePath))`
**Edge cases:** `KAFKA_BROKERS` empty → process exits with error code 1 before starting; Kafka connection failure → process exits 1
**Confidence:** high

---

## cap-quotas-plans

### fn-quotas-01
**Behavior:** Resolve tenant effective capabilities: intersect `plan.capabilityKeys` with capabilities from `deploymentProfile.providerCapabilityIds`; return only enabled capabilities; throw on unknown `planId` or missing quota policy/deployment profile.
**Parent cap:** cap-quotas-plans
**Entry point:** `services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities`
**Evidence:** `services/internal-contracts/src/index.mjs:1111-1145`
**Edge cases:** Empty `plan.capabilityKeys` → no enabled capabilities; unknown `planId` → `Error('Unknown plan')`; missing `quotaPolicy` → `Error`
**Confidence:** high

### fn-quotas-02
**Behavior:** Resolve workspace effective capabilities as a further filter of tenant capabilities: only capabilities whose `allowedEnvironments` includes the workspace environment are included.
**Parent cap:** cap-quotas-plans
**Entry point:** `services/internal-contracts/src/index.mjs::resolveWorkspaceEffectiveCapabilities`
**Evidence:** `services/internal-contracts/src/index.mjs:1147-1165`
**Edge cases:** Workspace in `staging` environment cannot access production-only capabilities; inherits tenant resolution errors
**Confidence:** high

### fn-quotas-03
**Behavior:** Gateway blocks access to plan-gated API families unless the tenant's resolved plan includes at least one of the `planCapabilityAnyOf` keys; denial emits a capability-enforcement audit event.
**Parent cap:** cap-quotas-plans
**Entry point:** `services/gateway-config/base/public-api-routing.yaml` — `planCapabilityAnyOf` per family
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:271-274` (iam: `identity.sso.oidc`), `:282-289` (postgres), `:292-299` (mongo), `:302-309` (events), `:312-320` (functions), `:322-330` (storage), `:331-339` (metrics)
**Edge cases:** No plan in token claims → all gated families blocked; `planCapabilityAnyOf` requires at least one match (OR semantics)
**Confidence:** high

### fn-quotas-04
**Behavior:** Hard-limit quota enforcement: when a dimension (e.g., `workspace.kafka_topics.max`, `workspace.scheduling.jobs.max`) is exceeded, reject the write operation and emit `quota.hard_limit_exceeded` audit event to Kafka topic `console.quota.hard_limit.blocked`.
**Parent cap:** cap-quotas-plans
**Entry point:** `services/scheduling-engine/src/quota.mjs::checkJobCreationQuota`; internal-contracts hard-limit enforcement contract
**Evidence:** `services/internal-contracts/src/index.mjs::getHardLimitAuditContract`; `listHardLimitDimensions`; `services/scheduling-engine/src/quota.mjs:3-8`
**Edge cases:** `allowed=false` → caller must reject request; `reason` field contains human-readable limit message for response body
**Confidence:** high

---

## cap-audit

### fn-audit-01
**Behavior:** Every audit event must include required top-level fields: actor (id, type), scope_envelope (tenant_id, workspace_id), resource (type, id), action (verb, result), origin (surface, correlation_id), timestamp.
**Parent cap:** cap-audit
**Entry point:** `services/internal-contracts/src/index.mjs::getAuditEventRequiredFields`; `getAuditScopeEnvelope`
**Evidence:** `services/internal-contracts/src/index.mjs:497-546`
**Edge cases:** Events missing `scope_envelope.tenant_id` fail schema validation; `capabilityEnforcementDeniedEvent` triggers extended retention in security category
**Confidence:** high

### fn-audit-02
**Behavior:** Query audit events by scope (tenant/workspace/platform) with filter dimensions and cursor-based pagination; response contract includes correlation_id for cross-subsystem trace.
**Parent cap:** cap-audit
**Entry point:** `apps/control-plane/src/observability-audit-query.mjs`; `GET /v1/admin/audit/events`
**Evidence:** `services/internal-contracts/src/index.mjs::listAuditQueryScopes`; `getAuditQueryPaginationPolicy`; `getAuditQueryResponseContract`
**Edge cases:** Platform-scope query requires `platform_auditor` or `platform_admin` role; tenant-scope limited to own tenant
**Confidence:** high

### fn-audit-03
**Behavior:** Export audit events with masking profiles (redact sensitive fields per profile); supported formats (e.g., JSON, CSV); export scope validated before data delivery.
**Parent cap:** cap-audit
**Entry point:** `apps/control-plane/src/observability-audit-export.mjs`; `POST /v1/admin/audit/export`
**Evidence:** `services/internal-contracts/src/index.mjs::listAuditExportMaskingProfiles`; `listAuditExportFormats`; `getAuditExportSensitiveFieldRules`
**Edge cases:** Masking compatibility with correlation surface must be validated before combined export+correlate
**Confidence:** high

### fn-audit-04
**Behavior:** Correlate audit events by `correlationId` across subsystems; build timeline view with phases; surface downstream trace sources.
**Parent cap:** cap-audit
**Entry point:** `apps/control-plane/src/observability-audit-correlation.mjs`; `GET /v1/admin/audit/correlate/{correlationId}`
**Evidence:** `services/internal-contracts/src/index.mjs::listAuditCorrelationScopes`; `listAuditCorrelationTimelinePhases`; `getAuditCorrelationMaskingCompatibility`
**Edge cases:** Missing correlation_id on source events prevents tracing; masking must be consistent across correlated events
**Confidence:** high

---

## cap-metrics

### fn-metrics-01
**Behavior:** Expose time-series metrics for workspaces and tenants, gated by `observability.metrics.basic` plan capability; returns aggregated metric families with cardinality controls.
**Parent cap:** cap-metrics
**Entry point:** `GET /v1/metrics/*`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:349-360` (metrics family); `services/internal-contracts/src/index.mjs::listObservabilityMetricFamilies`
**Edge cases:** Missing plan capability → 403 at gateway; metrics family QoS: 300 req/min
**Confidence:** high

### fn-metrics-02
**Behavior:** Emit threshold alerts to `quota.threshold.alerts` Kafka topic when usage dimensions exceed configured thresholds; supports suppression and oscillation detection.
**Parent cap:** cap-metrics
**Entry point:** `services/internal-contracts/src/index.mjs::getAlertKafkaTopicConfig`; `getAlertOscillationDetection`; `getAlertSuppressionDefaults`
**Evidence:** `services/internal-contracts/src/index.mjs:776-929`
**Edge cases:** Oscillation detection prevents alert storms; suppression causes documented in `listAlertSuppressionCauses`
**Confidence:** high

---

## cap-gateway

### fn-gateway-01
**Behavior:** Capability-gate check: 5 routes are blocked at the APISIX gateway unless the specific capability is enabled in the tenant plan: `webhooks`, `realtime`, `sql_admin_api`, `passthrough_admin`, `functions_public`.
**Parent cap:** cap-gateway
**Entry point:** `services/gateway-config/routes/capability-gated-routes.yaml`
**Evidence:** `services/gateway-config/routes/capability-gated-routes.yaml:15-44`
**Edge cases:** Gateway-level denial (pre-upstream) is the first enforcement layer; backend services may apply additional checks
**Confidence:** high

### fn-gateway-02
**Behavior:** Rate limiting per QoS class: `control-write` (240/min burst 60), `catalog` (180/min burst 40), `event-gateway-publish` (180/min burst 60), `observability` (300/min burst 80), `native-admin` (30/min burst 10).
**Parent cap:** cap-gateway
**Entry point:** `services/gateway-config/base/public-api-routing.yaml::qosProfiles`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:136-190`
**Edge cases:** `native_admin` is most restrictive (30/min); retry profile `mutations` has 0 retries to prevent double-write
**Confidence:** high

### fn-gateway-03
**Behavior:** CORS policy: origins restricted to `console_hostname`; credentials allowed; exposes `X-Correlation-Id`, `X-Idempotency-Replayed`, `X-RateLimit-*` response headers; max-age 3600 s.
**Parent cap:** cap-gateway
**Entry point:** `services/gateway-config/base/public-api-routing.yaml::corsProfiles.product_api`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:448-466`
**Edge cases:** `allowOrigins: [console_hostname]` — third-party cross-origin requests blocked; `allowCredentials: true` required for session cookies
**Confidence:** high

### fn-gateway-04
**Behavior:** Error responses always include structured envelope with `status`, `code`, `message`, `detail`, `requestId`, `correlationId`, `timestamp`, `resource`; `X-Correlation-Id` always set in response.
**Parent cap:** cap-gateway
**Entry point:** `services/gateway-config/base/public-api-routing.yaml::errorEnvelope`
**Evidence:** `services/gateway-config/base/public-api-routing.yaml:28-40`
**Edge cases:** `X-Correlation-Id` is auto-generated if missing from request (`generateWhenMissing: true`); `X-Request-Id` tracked as sibling header
**Confidence:** high
