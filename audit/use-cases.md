# Use Cases — Falcone BaaS (source-derived)

> Every step is anchored to a real code path (`path::symbol` or `file:line`).
> Tenant context is explicit in each flow. Generated: 2026-06-08.

---

## Table of Contents

1. [Domain A — Tenant Lifecycle & Management](#domain-a--tenant-lifecycle--management)
   - [uc-tenant-01 — Provision a new tenant (platform operator)](#uc-tenant-01--provision-a-new-tenant)
   - [uc-tenant-02 — Suspend a tenant](#uc-tenant-02--suspend-a-tenant)
   - [uc-tenant-03 — Purge a soft-deleted tenant](#uc-tenant-03--purge-a-soft-deleted-tenant)
   - [uc-tenant-04 — Export tenant functional configuration](#uc-tenant-04--export-tenant-functional-configuration)
2. [Domain B — Workspace Lifecycle](#domain-b--workspace-lifecycle)
   - [uc-workspace-01 — Create a workspace inside a tenant](#uc-workspace-01--create-a-workspace-inside-a-tenant)
   - [uc-workspace-02 — Clone a workspace](#uc-workspace-02--clone-a-workspace)
3. [Domain C — Authentication & IAM](#domain-c--authentication--iam)
   - [uc-auth-01 — Console login (OIDC delegated)](#uc-auth-01--console-login-oidc-delegated)
   - [uc-auth-02 — User signup with pending-activation](#uc-auth-02--user-signup-with-pending-activation)
   - [uc-auth-03 — Approve a pending user (workspace admin)](#uc-auth-03--approve-a-pending-user)
   - [uc-iam-01 — Manage Keycloak realm/client for a tenant](#uc-iam-01--manage-keycloak-realmclient-for-a-tenant)
   - [uc-iam-02 — Create and rotate a service account credential](#uc-iam-02--create-and-rotate-a-service-account-credential)
4. [Domain D — Token Validation & Context Propagation](#domain-d--token-validation--context-propagation)
   - [uc-token-01 — Validate a Bearer JWT through the gateway](#uc-token-01--validate-a-bearer-jwt-through-the-gateway)
   - [uc-ctx-01 — Reject spoofed tenant-context headers](#uc-ctx-01--reject-spoofed-tenant-context-headers)
5. [Domain E — PostgreSQL Data API](#domain-e--postgresql-data-api)
   - [uc-pg-01 — Provision a Postgres database for a workspace](#uc-pg-01--provision-a-postgres-database-for-a-workspace)
   - [uc-pg-02 — Execute admin SQL (plan-gated)](#uc-pg-02--execute-admin-sql-plan-gated)
   - [uc-pg-cdc-01 — Enable Postgres CDC to Kafka](#uc-pg-cdc-01--enable-postgres-cdc-to-kafka)
6. [Domain F — MongoDB Data API](#domain-f--mongodb-data-api)
   - [uc-mongo-01 — Enable MongoDB CDC with resume-token durability](#uc-mongo-01--enable-mongodb-cdc-with-resume-token-durability)
7. [Domain G — Object Storage](#domain-g--object-storage)
   - [uc-storage-01 — Create a bucket (tenant storage context gating)](#uc-storage-01--create-a-bucket)
   - [uc-storage-02 — Issue and rotate programmatic storage credentials](#uc-storage-02--issue-and-rotate-programmatic-storage-credentials)
   - [uc-storage-03 — Import objects into a bucket with manifest](#uc-storage-03--import-objects-into-a-bucket-with-manifest)
8. [Domain H — Realtime / WebSocket](#domain-h--realtime--websocket)
   - [uc-realtime-01 — Open a realtime WebSocket subscription](#uc-realtime-01--open-a-realtime-websocket-subscription)
   - [uc-realtime-02 — Token expiry triggers session suspension](#uc-realtime-02--token-expiry-triggers-session-suspension)
   - [uc-realtime-03 — Resume a suspended realtime session](#uc-realtime-03--resume-a-suspended-realtime-session)
9. [Domain I — Events / Kafka](#domain-i--events--kafka)
   - [uc-events-01 — Publish a CloudEvent to a workspace Kafka topic](#uc-events-01--publish-a-cloudevent-to-a-workspace-kafka-topic)
   - [uc-events-02 — Create a Kafka-topic trigger for a function](#uc-events-02--create-a-kafka-topic-trigger-for-a-function)
10. [Domain J — Functions / Serverless](#domain-j--functions--serverless)
    - [uc-fn-01 — Deploy a serverless function action](#uc-fn-01--deploy-a-serverless-function-action)
    - [uc-fn-02 — Invoke a function synchronously](#uc-fn-02--invoke-a-function-synchronously)
    - [uc-fn-03 — Create a cron trigger for a function](#uc-fn-03--create-a-cron-trigger-for-a-function)
    - [uc-fn-04 — Import a function bundle (scoped)](#uc-fn-04--import-a-function-bundle-scoped)
11. [Domain K — Webhooks](#domain-k--webhooks)
    - [uc-wh-01 — Create a webhook subscription (SSRF guard)](#uc-wh-01--create-a-webhook-subscription)
    - [uc-wh-02 — Pause and re-activate a webhook subscription](#uc-wh-02--pause-and-re-activate-a-webhook-subscription)
12. [Domain L — Scheduling](#domain-l--scheduling)
    - [uc-sched-01 — Create a cron scheduled job](#uc-sched-01--create-a-cron-scheduled-job)
    - [uc-sched-02 — Automatic job erroring on consecutive failures](#uc-sched-02--automatic-job-erroring-on-consecutive-failures)
13. [Domain M — Backup & Restore](#domain-m--backup--restore)
    - [uc-backup-01 — Trigger an on-demand backup (tenant owner)](#uc-backup-01--trigger-an-on-demand-backup)
    - [uc-backup-02 — Cross-tenant backup denied (IDOR probe)](#uc-backup-02--cross-tenant-backup-denied)
14. [Domain N — Secrets Management](#domain-n--secrets-management)
    - [uc-secrets-01 — Vault audit log tailed and published to Kafka](#uc-secrets-01--vault-audit-log-tailed-and-published-to-kafka)
15. [Domain O — Quotas, Plans & Capabilities](#domain-o--quotas-plans--capabilities)
    - [uc-quota-01 — Plan capability gate blocks ungated API family](#uc-quota-01--plan-capability-gate-blocks-ungated-api-family)
    - [uc-quota-02 — Hard quota limit rejects write and emits audit event](#uc-quota-02--hard-quota-limit-rejects-write-and-emits-audit-event)
16. [Domain P — Audit & Observability](#domain-p--audit--observability)
    - [uc-audit-01 — Query tenant audit events (scoped, paginated)](#uc-audit-01--query-tenant-audit-events)
    - [uc-audit-02 — Correlate audit events by correlationId](#uc-audit-02--correlate-audit-events-by-correlationid)
17. [Domain Q — Gateway](#domain-q--gateway)
    - [uc-gw-01 — Idempotent mutation replay via gateway](#uc-gw-01--idempotent-mutation-replay-via-gateway)
    - [uc-gw-02 — Capability-gated route blocked at APISIX](#uc-gw-02--capability-gated-route-blocked-at-apisix)

---

## Domain A — Tenant Lifecycle & Management

---

### uc-tenant-01 — Provision a new tenant

**Title:** Platform operator provisions a new tenant via WF-CON-002

**Capabilities / Functionalities:** cap-tenant-provisioning, cap-tenant-lifecycle / fn-provisioning-01, fn-provisioning-02

**Primary actor:** Platform operator (`actorType: superadmin`)

**Tenant context:** No tenant exists yet; the workflow creates the tenant record and all its infrastructure. The caller's `tenantId` in `callerContext` is `superadmin` (platform scope) until the new tenant is written.

**Preconditions:**
- Caller has authenticated as `superadmin`.
- A unique `idempotencyKey` (UUID v4) and a `correlationId` are supplied.
- Downstream services (Keycloak, Kafka, APISIX) are reachable.

**Trigger:** `POST /v1/admin/tenants` (or direct OpenWhisk invocation of workflow `WF-CON-002`).

**Main success flow:**

1. Gateway receives the request; validates `Idempotency-Key`, injects `X-Correlation-Id`, propagates `X-Tenant-Id`, `X-Actor-Roles` to control-plane.
   Code: `services/gateway-config/base/public-api-routing.yaml:211-218` (propagatedHeaders anchor `&a1`)

2. Control-plane invokes `handleTenantProvisioning(request)`.
   Code: `apps/control-plane/src/workflows/wf-con-002.mjs` → `handleTenantProvisioning`

3. Guard: `request.callerContext.actorType !== 'superadmin'` → short-circuit with `FORBIDDEN`.
   Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:128-130`

4. `validateInvocationRequest(request)` checks: `workflowId` matches `WF-CON-0NN`, `idempotencyKey` is UUID v4, `callerContext.actor` and `callerContext.tenantId` present, `callerContext.correlationId` present, `input.adminEmail` contains `@`.
   Code: `apps/control-plane/src/workflows/workflow-invocation-contract.mjs:65-103`

5. `validateCallerAuthorization` checks workflow authorization model (`isolation: superadmin`).
   Code: `apps/control-plane/src/workflows/workflow-invocation-contract.mjs:106-145`

6. `checkIdempotency(idempotencyKey)` — if a prior matching request exists and succeeded/failed, returns the cached result immediately.
   Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:147-153`

7. `registerJob('WF-CON-002', ...)` persists the async job reference; `markPending` writes idempotency record.
   Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:156-163`

8. `dispatchWorkflowAction(OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-002'], ...)` fires async OpenWhisk invocation.
   Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:170-182`

9. Returns `{ status: 'pending', jobRef }` with HTTP 202.

10. Async `runTenantProvisioningAction(request)` executes the saga:
    a. `createRealm({ request, jobRef })` → creates Keycloak realm (`keycloakAdmin.createRealm`). Pushes `{ type: 'keycloak_realm', id: realm.realmId }` to `affectedResources`.
       Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:75-77`
    b. `writeTenantRecord({ request, jobRef, realm })` → persists tenant in control DB. Pushes `tenant_record`.
       Code: line 78-80
    c. `createTopicNamespace({ request, jobRef, tenantRecord })` → `kafkaAdmin.createTopicNamespace`. Pushes `kafka_topic_namespace`.
       Code: line 81-83
    d. `registerApisixRoutes({ ... })` → registers gateway routes for the new tenant. Pushes `apisix_route_configuration`.
       Code: line 84-86
    e. `updateJobStatus(jobRef, 'succeeded', result)` → `markSucceeded(idempotencyKey, result)`.
       Code: line 104-105

11. Audit `withAudit(result, callerContext, affectedResources)` produces audit fields: `workflowId`, `actor`, `tenantId`, `timestamp`, `affectedResources`, `outcome`.
    Code: `apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs:40-45`

**Postconditions:** Keycloak realm, tenant DB record, Kafka topic namespace, and APISIX routes exist. Tenant state is `active` (or `provisioning` until all appliers complete). Async job record is `succeeded`.

**Observable outputs:** HTTP 202 with `{ status: 'pending', jobRef }`; async job transitions to `succeeded`; audit event written by `buildAuditFields`.

---

### uc-tenant-02 — Suspend a tenant

**Title:** Platform operator suspends an active tenant

**Capabilities / Functionalities:** cap-tenant-lifecycle / fn-tenant-lifecycle-01

**Primary actor:** Platform operator (elevated role)

**Tenant context:** The target tenant (`ten_<ulid>`) is in state `active`. The operator's `callerContext.tenantId` may differ (platform-level scope).

**Preconditions:**
- Tenant exists and is `active`.
- Caller has `hasElevatedAccess = true` (required for destructive transitions).
- All workspaces are in a state that allows the parent tenant to transition (state machine validation).

**Trigger:** `PATCH /v1/admin/tenants/{tenantId}` with `action: 'suspend'`.

**Main success flow:**

1. Gateway validates Bearer token; propagates `X-Tenant-Id`, `X-Actor-Roles` to control-plane.
   Code: `services/gateway-config/base/public-api-routing.yaml:221-233` (tenants family, `tenantBinding: required`)

2. Control-plane calls `previewTenantLifecycleMutation({ tenant, action: 'suspend', workspaces, hasElevatedAccess })`.
   Code: `apps/control-plane/src/tenant-management.mjs:91-108`

3. Internally calls `evaluateTenantLifecycleMutation({ tenant, action, workspaces, hasElevatedAccess })` from internal-contracts.
   Code: `services/internal-contracts/src/domain-model.json` (business_state_machines, lifecycle_transitions)

4. State machine allows `active → suspended`; returns `{ allowed: true, nextState: 'suspended' }`.

5. Control-plane writes updated tenant state to DB; cascades to storage context (credential health → `revoked`).
   Code: `services/adapters/src/storage-tenant-context.mjs:65-78` (`normalizeCredentialHealth` returns `'revoked'` when `state === 'suspended'`)

6. Audit event emitted with `scope_envelope.tenant_id`, action `suspend`, result `succeeded`.

**Alternate flows:**

- A-1: Workspace in non-suspendable state → `evaluateTenantLifecycleMutation` returns `{ allowed: false, reason: 'workspace_in_incompatible_state' }` → 422 with structured error.

**Error flows:**

- E-1: `hasElevatedAccess = false` for purge/delete → blocked by state machine guard; `evaluateTenantLifecycleMutation` returns `allowed: false`.
  Code: `services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation` (elevated access check)

**Postconditions:** Tenant state = `suspended`; storage context credential health = `revoked`; all new API requests on behalf of this tenant receive 403/suspended error.

**Linked:** bbx-tenant-lifecycle-suspend

---

### uc-tenant-03 — Purge a soft-deleted tenant

**Title:** Platform operator purges a soft-deleted tenant with dual confirmation

**Capabilities / Functionalities:** cap-tenant-lifecycle / fn-tenant-lifecycle-01, fn-tenant-lifecycle-02

**Primary actor:** Platform operator (`hasElevatedAccess = true`, `hasSecondConfirmation = true`)

**Tenant context:** Target tenant is in state `soft_deleted`. Cross-tenant scope: operator is acting on another tenant's data.

**Preconditions:**
- Tenant is in state `soft_deleted` (must have gone through `active → suspended → soft_deleted` prior).
- `hasElevatedAccess = true` AND `hasSecondConfirmation = true` both present in request.
- `approvalTicket` (non-empty) and `confirmationText` (verbatim) supplied.

**Trigger:** `DELETE /v1/admin/tenants/{tenantId}` (purge action).

**Main success flow:**

1. `buildTenantPurgeRequestDraft({ tenant, actorUserId, approvalTicket, confirmationText })` constructs the purge draft.
   Code: `apps/control-plane/src/tenant-management.mjs:111-113` → `buildTenantPurgeDraft`

2. `previewTenantLifecycleMutation({ ..., action: 'purge', hasElevatedAccess: true, hasSecondConfirmation: true })` validates the transition.
   Code: `apps/control-plane/src/tenant-management.mjs:91-108`; `services/internal-contracts/src/domain-model.json` (purge requires both flags)

3. Provisioning saga executes purge appliers (reverse order: OpenWhisk namespace, storage, MongoDB, Postgres, Kafka, Keycloak realm).
   Code: `services/provisioning-orchestrator/src/appliers/` (each applier's `apply(tenantId, domainData, { dryRun: false })`)

4. Audit event `tenant.purged` emitted with `scope_envelope.tenant_id`, affected resources list.

**Error flows:**

- E-1: `hasElevatedAccess = false` → state machine blocks; returns `{ allowed: false }` → 422.
- E-2: `hasSecondConfirmation = false` → same block for purge transitions.
- E-3: Empty `approvalTicket` → semantically incomplete draft; consumer-level validation rejects.
  Code: `apps/control-plane/src/tenant-management.mjs:111` (parameters passed verbatim)

**Postconditions:** All tenant resources deleted; tenant record soft-purged; no orphaned Keycloak realms, Kafka namespaces, or storage buckets remain.

**Linked:** bbx-tenant-purge

---

### uc-tenant-04 — Export tenant functional configuration

**Title:** Tenant admin exports a full functional configuration snapshot

**Capabilities / Functionalities:** cap-tenant-lifecycle / fn-tenant-lifecycle-04

**Primary actor:** Tenant admin

**Tenant context:** The calling actor's `tenantId` must match the target tenant. Platform admins may export any tenant.

**Preconditions:** Tenant is active. Actor has `tenant_admin` or `platform_admin` role.

**Trigger:** `GET /v1/admin/tenants/{tenantId}/export`

**Main success flow:**

1. `previewTenantFunctionalExport({ tenant, workspaces, externalApplications, serviceAccounts, managedResources })` called.
   Code: `apps/control-plane/src/tenant-management.mjs:73-89`

2. Internally calls `buildTenantFunctionalConfigurationExport(...)` which produces a structured artifact with sections: `tenant`, `labels`, `quotas`, `governance`, workspace/application/service-account/managed-resource inventories, `redactionMode`, `recoveryArtifacts`.
   Code: `services/internal-contracts/src/index.mjs:1362-1406`

3. `redactionMode` defaults to `'secret_references_only'` — secret values are never included.
   Code: `services/internal-contracts/src/index.mjs` (includedSections, recoveryArtifacts)

4. Response carries the export artifact. `X-Correlation-Id` present in response.

**Alternate flows:**

- A-1: Missing `exportProfile` → synthetic IDs generated; no error.

**Error flows:**

- E-1: Actor's `tenantId` does not match target → 403 from gateway tenant-binding enforcement.
  Code: `services/gateway-config/base/public-api-routing.yaml:229` (`tenantBinding: required`)

**Postconditions:** Export artifact returned; audit event `tenant.config_exported` emitted.

**Linked:** bbx-tenant-export

---

## Domain B — Workspace Lifecycle

---

### uc-workspace-01 — Create a workspace inside a tenant

**Title:** Tenant admin creates a new workspace (WF-CON-003)

**Capabilities / Functionalities:** cap-workspace-lifecycle / fn-workspace-lifecycle-01, fn-workspace-lifecycle-03

**Primary actor:** Tenant admin (`actorType: tenant_admin` or `workspace_creator`)

**Tenant context:** The caller's `callerContext.tenantId` must equal the `requestTenantId`. Cross-tenant boundary check is explicit in the workflow.

**Preconditions:**
- Tenant is in state `active`.
- Tenant storage context is `active` and `bucketProvisioningAllowed = true` (checked by `provisionWorkspaceStorageBoundary`).
- `idempotencyKey` (UUID v4) and `correlationId` supplied.

**Trigger:** `POST /v1/workspaces` or OpenWhisk invocation of WF-CON-003.

**Main success flow:**

1. `handleWorkspaceCreation(request)` validates invocation request and caller authorization.
   Code: `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs:119-134`

2. Cross-tenant boundary guard: `callerContext.requestTenantId && requestTenantId !== callerContext.tenantId` → `FORBIDDEN`.
   Code: `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs:135-137`

3. `checkIdempotency(idempotencyKey)` — replay prior result if found.
   Code: line 139-145

4. `registerJob` + `markPending` + `dispatchWorkflowAction(OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-003'], ...)`.
   Code: line 148-174

5. Returns `{ status: 'pending', jobRef }` with HTTP 202.

6. Async `runWorkspaceCreationAction(request)`:
   a. `createClient(...)` → `keycloakAdmin.createClient` creates an OIDC client in the tenant Keycloak realm. Pushes `{ type: 'keycloak_client', id: client.clientId }`.
      Code: `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs:72-73`
   b. `writeWorkspaceRecord(...)` → persists workspace in DB with `tenantId`. Pushes `workspace_record`.
      Code: line 74-76
   c. `provisionWorkspaceStorageBoundary(...)` → `storageTenantContext.provisionWorkspaceStorageBoundary` allocates the workspace's storage boundary within the tenant's namespace. Pushes `workspace_storage_boundary`.
      Code: line 77-79
   d. `updateJobStatus('succeeded')` + `markSucceeded`.

7. `resolveWorkspaceApiSurface` is available to derive the workspace's `controlApiBaseUrl`, `realtimeBaseUrl`, `identityBaseUrl` per the workspace environment.
   Code: `services/internal-contracts/src/index.mjs:1183-1239` (called from `workspace-management.mjs:29`)

**Error flows:**

- E-1: `requestTenantId` differs from `callerContext.tenantId` → `FORBIDDEN, 'Caller cannot cross tenant boundaries.'`
  Code: `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs:135-137`
- E-2: `createClient` fails (Keycloak down) → `failedStep: 'create_keycloak_client'`; job `failed`, `markFailed` called.
  Code: line 101-115
- E-3: Tenant storage context not active → `provisionWorkspaceStorageBoundary` returns `requestedState: 'dependency_wait'` or `'blocked'`.
  Code: `services/adapters/src/storage-tenant-context.mjs:384-461` (`previewWorkspaceStorageBootstrap`)

**Postconditions:** Keycloak client exists in tenant realm; workspace DB record created with `tenantId`; storage boundary provisioned within tenant namespace. Audit fields carry `tenantId`, `workspaceId`, `affectedResources`.

**Linked:** bbx-workspace-create

---

### uc-workspace-02 — Clone a workspace

**Title:** Tenant admin clones an existing workspace into a new one

**Capabilities / Functionalities:** cap-workspace-lifecycle / fn-workspace-lifecycle-01, fn-workspace-lifecycle-02

**Primary actor:** Tenant admin

**Tenant context:** Both source and target workspaces must belong to the same tenant. `sourceWorkspace.workspaceId` is required; both workspaces share `tenantId`.

**Preconditions:**
- Source workspace exists in the same tenant and is in a clonable state.
- Caller has `tenant_admin` or `workspace_creator` role scoped to this tenant.

**Trigger:** `POST /v1/workspaces/{sourceWorkspaceId}/clone`

**Main success flow:**

1. `buildWorkspaceCloneDraft(sourceWorkspace, clonePolicy)` constructs the clone draft, setting `resourceInheritance.mode = 'clone_workspace'` and `sourceRef = sourceWorkspace.workspaceId`. `resetCredentialReferences: true` by default prevents any credentials from leaking into the clone.
   Code: `services/internal-contracts/src/index.mjs:1267-1300`

2. `resolveWorkspaceResourceInheritance(cloneDraft)` classifies resources as `sharedResourceKeys` (those with `sharingScope === 'tenant_shared'`) vs. `specializedResourceKeys`; sets `requiresCloneLineage = true` for clone mode.
   Code: `services/internal-contracts/src/index.mjs:1241-1265`

3. Workspace creation follows the same WF-CON-003 path with the clone draft as input.

4. Shared tenant-level resources (e.g., Kafka topic namespaces) are referenced, not duplicated.

**Error flows:**

- E-1: `sourceWorkspace.workspaceId` missing → throws immediately.
  Code: `services/internal-contracts/src/index.mjs:1267` (guard in `buildWorkspaceCloneDraft`)
- E-2: Source workspace belongs to a different tenant → gateway `tenantBinding: required` blocks the request.

**Postconditions:** New workspace exists; no credentials copied from source (reset); shared resources reuse tenant-level references; clone lineage tracked.

**Linked:** bbx-workspace-clone

---

## Domain C — Authentication & IAM

---

### uc-auth-01 — Console login (OIDC delegated)

**Title:** Console user authenticates via OIDC delegated flow

**Capabilities / Functionalities:** cap-auth-console / fn-auth-01

**Primary actor:** Workspace member (any authenticated user)

**Tenant context:** The `auth` family has `tenantBinding: none` — authentication is pre-tenant. After login, the token's `tenant_id` claim identifies the user's tenant.

**Preconditions:** Keycloak realm for the tenant is provisioned and active.

**Trigger:** `POST /v1/auth/login`

**Main success flow:**

1. Gateway routes request to `auth` family upstream (`authMode: delegated_oidc`); no tenant binding required at this stage.
   Code: `services/gateway-config/base/public-api-routing.yaml:247-259`

2. Control-plane `console-auth.mjs` delegates to Keycloak OIDC endpoint in the user's realm.
   Code: `apps/control-plane/src/console-auth.mjs:27-38` (`summarizeConsoleAuthSurface`)

3. On successful OIDC token grant: JWT returned to client.

4. Subsequent requests carry `Authorization: Bearer <jwt>`; gateway validates token and propagates `X-Tenant-Id` from `tenant_id` claim.

**Alternate flows:**

- A-1: `account_suspended` status view — login page shows suspension message; no token issued.
  Code: `apps/control-plane/src/console-auth.mjs:9-16` (`CONSOLE_AUTH_STATUS_VIEWS`)
- A-2: `credentials_expired` — user redirected to password recovery flow.

**Error flows:**

- E-1: Invalid credentials → Keycloak returns 401; delegated error forwarded.
- E-2: Token expired on subsequent request → `validateToken` throws `TOKEN_EXPIRED`.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:88-92`

**Postconditions:** User holds a valid JWT with `tenant_id`, `scopes`, `authorizedWorkspaces`.

---

### uc-auth-02 — User signup with pending-activation

**Title:** New user signs up; enters pending-activation state awaiting approval

**Capabilities / Functionalities:** cap-auth-console / fn-auth-02

**Primary actor:** Anonymous user

**Tenant context:** Signup may be tenant-specific (invite link) or global. The `auth` family has `tenantBinding: none`.

**Preconditions:** Signup policy allows registration (`GET /v1/auth/signups/policy` returns open or invite-only).

**Trigger:** `POST /v1/auth/signup`

**Main success flow:**

1. Gateway accepts unauthenticated `POST /v1/auth/signup`; `auth` family has public routes (`authRequired: false`).
   Code: `apps/control-plane/src/console-auth.mjs:28` (`consoleAuthRoutes.filter(route => route.authRequired === false)`)

2. User record created in Keycloak realm with status `pending_activation`.

3. Signup confirmation email dispatched (external mechanism; not code-verified).

4. User presented with `pending_activation` status view.
   Code: `apps/control-plane/src/console-auth.mjs:9-16` (`CONSOLE_AUTH_STATUS_VIEWS` includes `'pending_activation'`)

**Error flows:**

- E-1: Signup policy is invite-only (`GET /v1/auth/signups/policy` returns closed) → 403.

**Postconditions:** User account in `pending_activation` state; no token issued; workspace admin must approve.

---

### uc-auth-03 — Approve a pending user

**Title:** Workspace admin approves a pending user (WF-CON-001)

**Capabilities / Functionalities:** cap-external-apps-service-accounts / fn-iam-01

**Primary actor:** Workspace admin (`actorType: workspace_admin` or `tenant_admin`)

**Tenant context:** `callerContext.tenantId` must match the workspace's tenant. Explicit cross-tenant check via `getScopeValidation` in WF-CON-001.

**Preconditions:** User is in `pending_activation`; admin has `workspace_admin` role in the target workspace.

**Trigger:** Workflow invocation `WF-CON-001` with `input.userId`, `input.requestedRole`, `input.targetWorkspaceId`.

**Main success flow:**

1. `handleUserApproval(request)` validates the invocation request (workflowId, idempotencyKey, callerContext).
   Code: `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs:55-68`

2. `validateCallerAuthorization(callerContext, 'WF-CON-001', WORKFLOW_AUTHORIZATION_MODEL)` checks required roles.
   Code: `apps/control-plane/src/workflows/workflow-invocation-contract.mjs:106-145`

3. `getScopeValidation(request)` → `validateConsoleBackendScope(...)` checks that `requestTenantId === callerContext.tenantId` and `requestWorkspaceId === callerContext.workspaceId`.
   Code: `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs:39-45`

4. `checkIdempotency` / `markPending`.

5. `assignRole({ tenantId, workspaceId, userId, requestedRole })` → `keycloakAdmin.assignRole` in the tenant Keycloak realm.
   Code: `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs:100-109`

6. `activateMembership({ tenantId, workspaceId, userId })` → writes membership record.
   Code: line 112-120

7. `markSucceeded` + audit fields with `grantedRole`, `userId`, `targetWorkspaceId`.

**Error flows:**

- E-1: `requestTenantId !== callerContext.tenantId` → `getScopeValidation` fails → `FORBIDDEN`.
  Code: `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs:71-73`
- E-2: Duplicate invocation (in-flight idempotency key) → `DUPLICATE_INVOCATION`.
  Code: line 82-84

**Postconditions:** User has `requestedRole` in the target workspace Keycloak realm; membership record active.

---

### uc-iam-01 — Manage Keycloak realm/client for a tenant

**Title:** Tenant admin creates or updates a Keycloak client (OIDC application) within the tenant realm

**Capabilities / Functionalities:** cap-iam-admin / fn-iam-01, fn-iam-02, fn-iam-03

**Primary actor:** Tenant admin with `identity.sso.oidc` plan capability

**Tenant context:** `X-Tenant-Id` header propagated by gateway; all Keycloak operations scoped to the tenant's realm. Reserved realm `master` and `in-falcone-platform` cannot be mutated.

**Preconditions:**
- Tenant plan includes `identity.sso.oidc` capability.
- Tenant realm exists (provisioned in WF-CON-002).

**Trigger:** `POST /v1/admin/iam/clients` with `{ realmId, clientId, protocol: 'openid-connect', redirectUris }`.

**Main success flow:**

1. Gateway checks `planCapabilityAnyOf: [identity.sso.oidc]` for the `iam` family.
   Code: `services/gateway-config/base/public-api-routing.yaml:273-274`

2. Gateway propagates `X-Tenant-Id`, `X-Plan-Id` to control-plane.

3. Control-plane validates `protocol` ∈ `['openid-connect', 'saml']`.
   Code: `services/adapters/src/keycloak-admin.mjs::SUPPORTED_CLIENT_PROTOCOLS`

4. Validates `clientId` not in `RESERVED_ROLE_NAMES` (14 platform roles blocked).
   Code: `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES`

5. Validates redirect URIs: all must be HTTPS (except localhost in dev mode).
   Code: `apps/control-plane/src/external-application-iam.mjs:15-30` (`isLikelyHttpsUri`)

6. `POST /realms/{tenantRealmId}/clients` Keycloak Admin API creates the client.

7. Response returns client ID; audit event emitted.

**Error flows:**

- E-1: Plan lacks `identity.sso.oidc` → gateway returns 403 `capability_denied` before reaching control-plane.
  Code: `services/gateway-config/base/public-api-routing.yaml:273-274`
- E-2: `realmId = 'master'` or `realmId = 'in-falcone-platform'` → rejected by `RESERVED_REALM_IDS` check.
  Code: `services/adapters/src/keycloak-admin.mjs::RESERVED_REALM_IDS`
- E-3: Unsupported protocol → rejected.

**Postconditions:** Keycloak client created in tenant realm; audit event with `tenant_id`, `resource.type = 'iam_client'`.

---

### uc-iam-02 — Create and rotate a service account credential

**Title:** Workspace developer creates a service account, then rotates its credential (WF-CON-006 + WF-CON-004)

**Capabilities / Functionalities:** cap-external-apps-service-accounts / fn-extapp-01, fn-extapp-02

**Primary actor:** Workspace developer (tenant member with `workspace_developer` role)

**Tenant context:** Scope validation enforced via `validateConsoleBackendScope`; `requestTenantId` must equal `callerContext.tenantId`; `requestWorkspaceId` must equal `callerContext.workspaceId`.

**Preconditions:**
- Workspace is active.
- Tenant plan allows the required number of service accounts (`external_application_plan_limits`).

**Trigger (create):** WF-CON-006 with `input.serviceAccountAction: 'create'`.
**Trigger (rotate):** WF-CON-004 with `input.credentialAction: 'rotate'`.

**Main success flow (create):**

1. `handleServiceAccountLifecycle(request)` → validates, authorizes, scope-checks.
   Code: `apps/control-plane/src/workflows/wf-con-006-service-account.mjs:59-99`

2. `createServiceAccount({ request, workspaceId })` → `keycloakAdmin.createServiceAccount` in tenant realm.
   Code: line 107-111

3. `writeServiceAccountRecord(...)` → persists record with `tenantId`, `workspaceId`.
   Code: line 110-111

4. `markSucceeded`; audit fields include `serviceAccountId`, `workspaceId`, `action: 'create'`.

**Main success flow (rotate with grace period):**

1. WF-CON-004 `credentialAction: 'rotate'`, `gracePeriodSeconds > 0`.
   Code: `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs:149-212`

2. `enforceRotationPolicy(currentPolicy, gracePeriodSeconds)` validates against tenant rotation policy.
   Code: line 152

3. `countActiveCredentials(...)` checked against `maxActiveCredentials` (default 3); if at limit → `CREDENTIAL_LIMIT_EXCEEDED`.
   Code: line 153-160

4. `getInProgressRotation(...)` checked; if a rotation is already active → `ROTATION_IN_PROGRESS`.
   Code: line 161-167

5. `rotateCredential({ additive: true })` → `keycloakAdmin.rotateClientCredential`; dual-key mode.
   Code: line 169

6. `updateGatewayCredential({ mode: 'dual-key' })` registers both old and new key in APISIX.
   Code: line 171

7. `createRotationStateRecord(...)` persists rotation state with `gracePeriodSeconds`, `oldCredentialId`, `newCredentialId`.
   Code: line 177-186

8. `publishRotationEvent(topic: 'console.credential-rotation.initiated')`.
   Code: line 188-199

9. `markSucceeded`; output includes `rotationStateId`, `deprecatedExpiresAt`.

**Error flows:**

- E-1: `requestTenantId !== callerContext.tenantId` → `FORBIDDEN` from `getScopeValidation`.
  Code: `apps/control-plane/src/workflows/wf-con-006-service-account.mjs:43-48`
- E-2: Active credential count at `maxActiveCredentials` → `CREDENTIAL_LIMIT_EXCEEDED`.
  Code: `apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs:155-159`
- E-3: Already an in-progress rotation → `ROTATION_IN_PROGRESS`.
  Code: line 161-166

**Postconditions:** Service account exists in Keycloak tenant realm; credential record written with `tenantId`, `workspaceId`; rotation event on `console.credential-rotation.initiated`.

---

## Domain D — Token Validation & Context Propagation

---

### uc-token-01 — Validate a Bearer JWT through the gateway

**Title:** Any authenticated request: gateway validates Bearer JWT and propagates tenant context

**Capabilities / Functionalities:** cap-token-validation, cap-context-propagation / fn-token-01, fn-token-02, fn-ctx-01

**Primary actor:** Any authenticated actor (tenant admin, workspace member, service account)

**Tenant context:** `tenant_id` claim extracted from JWT; propagated as `X-Tenant-Id` to all upstreams.

**Preconditions:** JWT issued by the tenant's Keycloak realm; JWKS endpoint accessible.

**Trigger:** Any request carrying `Authorization: Bearer <jwt>`.

**Main success flow:**

1. `createTokenValidator()` is called; `extractToken(bearerToken)` strips the `Bearer ` prefix.
   Code: `services/realtime-gateway/src/auth/token-validator.mjs:14-23`

2. `verifyLocally(token, env, forceRefresh=false)`: `decodeProtectedHeader(token)` extracts `kid`; `fetchSigningKey(env, kid)` uses LRU cache (TTL = `JWKS_CACHE_TTL_SECONDS`); `jwtVerify(token, key, { clockTolerance: '5 seconds' })`.
   Code: `services/realtime-gateway/src/auth/token-validator.mjs:153-163`

3. `normalizeClaims(payload)` extracts `sub`, `tenant_id`, `scopes`, `authorizedWorkspaces`, `exp`, `jti`.
   Code: `services/realtime-gateway/src/auth/token-validator.mjs:64-74`

4. Gateway injects normalized claims as headers: `X-Tenant-Id`, `X-Auth-Scopes`, `X-Actor-Roles`, `X-Auth-Subject`.
   Code: `services/gateway-config/base/public-api-routing.yaml:211-218`

**Alternate flows:**

- A-1: Unknown `kid` (after key rotation): `isUnknownKidError` → `verifyLocally(..., forceRefresh=true)` → re-fetch JWKS. If still unknown → `introspectToken(env, token)`.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:172-182`

- A-2: Keycloak token introspection returns `active: true` → `normalizeClaims(payload)` used.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:127-151`

**Error flows:**

- E-1: Missing `kid` in JWT header → `TOKEN_INVALID`.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:156-158`
- E-2: `ERR_JWT_EXPIRED` → `TOKEN_EXPIRED`.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:88-92`
- E-3: Introspection returns `active: false` → `TOKEN_REVOKED`.
  Code: `services/realtime-gateway/src/auth/token-validator.mjs:146-148`
- E-4: TEST_MODE enabled in production → 500 mis-configuration error.
  Code: `services/backup-status/src/api/backup-status.auth.js:45-67`

**Postconditions:** `tenant_id`, `scopes`, `authorizedWorkspaces` available to all upstream services via trusted headers.

---

### uc-ctx-01 — Reject spoofed tenant-context headers

**Title:** Attacker attempts to inject `X-Tenant-Id` header into a request

**Capabilities / Functionalities:** cap-context-propagation / fn-ctx-01

**Primary actor:** Malicious external caller

**Tenant context:** Attempted cross-tenant access by injecting headers.

**Preconditions:** Attacker has a valid JWT but wants to act on a different tenant's data.

**Trigger:** Request with custom `X-Tenant-Id: <victim-tenant>` header alongside a legitimate Bearer JWT.

**Main success flow (attack blocked):**

1. Gateway's `requestValidationProfile` includes `rejectSpoofedContextHeaders: true` for all families.
   Code: `services/gateway-config/base/public-api-routing.yaml:87-88` (platform_control), `:92-93` (tenant_control), `:98-99` (workspace_control), etc.

2. Gateway strips or rejects any `X-Tenant-Id`, `X-Workspace-Id`, `X-Plan-Id` headers arriving from the client.

3. Gateway re-derives these headers from the validated JWT claims only.

4. Upstream services receive the correct `X-Tenant-Id` from the JWT, not from the attacker's injection.

**Postconditions:** Cross-tenant header injection produces no effect; upstream always receives JWT-derived context.

---

## Domain E — PostgreSQL Data API

---

### uc-pg-01 — Provision a Postgres database for a workspace

**Title:** Workspace developer provisions a managed PostgreSQL database

**Capabilities / Functionalities:** cap-postgres-data-api / fn-pg-01

**Primary actor:** Workspace developer (tenant member with appropriate role)

**Tenant context:** `tenantBinding: required`, `workspaceBinding: required` for the `postgres` family. Admin profile resolved per workspace plan.

**Preconditions:**
- Tenant plan includes `data.postgresql.shared` or `data.postgresql.dedicated`.
- Workspace is active.

**Trigger:** `POST /v1/postgres/databases` with `workspaceId` in the JWT or path.

**Main success flow:**

1. Gateway checks `planCapabilityAnyOf: [data.postgresql.shared, data.postgresql.dedicated]`.
   Code: `services/gateway-config/base/public-api-routing.yaml:286-289`

2. `getPostgresCompatibilitySummary(context)` resolves the admin profile: placement mode (shared/dedicated), `allowedExtensions`, `adminSqlEnabled`, `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES`.
   Code: `apps/control-plane/src/postgres-admin.mjs:73-104`

3. `resolvePostgresAdminProfile(context)` in adapter determines schema allocation and access grants.
   Code: `services/adapters/src/postgresql-admin.mjs::resolvePostgresAdminProfile`

4. Postgres schema provisioned within the tenant's schema namespace (`CREATE SCHEMA tenant_*`).

5. Audit event emitted with `tenant_id`, `workspace_id`, `resource.type = 'postgres_database'`.

**Error flows:**

- E-1: Plan lacks `data.postgresql.*` → 403 from gateway.
  Code: `services/gateway-config/base/public-api-routing.yaml:286-289`

**Postconditions:** Postgres database provisioned; `adminSqlEnabled` flag persisted per profile.

---

### uc-pg-02 — Execute admin SQL (plan-gated)

**Title:** Workspace developer executes admin SQL via the `sql_admin_api` capability gate

**Capabilities / Functionalities:** cap-postgres-data-api / fn-pg-02

**Primary actor:** Workspace developer with `sql_admin_api` capability in plan

**Tenant context:** `X-Tenant-Id` and `X-Workspace-Id` propagated; SQL execution scoped to workspace schema via `SET app.tenant_id`.

**Preconditions:**
- Plan includes `sql_admin_api` capability.
- Actor role is in `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES`.

**Trigger:** `POST /v1/workspaces/{workspaceId}/sql`

**Main success flow:**

1. Gateway capability gate checks `sql_admin_api` from `capability-gated-routes.yaml`.
   Code: `services/gateway-config/routes/capability-gated-routes.yaml:27-35`

2. Control-plane verifies actor role against `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES`.
   Code: `apps/control-plane/src/postgres-admin.mjs` (`getPostgresCompatibilitySummary`)

3. Query executed against the workspace Postgres schema; `SET app.tenant_id` and `SET app.workspace_id` set before execution for RLS enforcement.

4. Result returned; audit event emitted.

**Error flows:**

- E-1: Plan lacks `sql_admin_api` → 403 at gateway, before hitting control-plane.
  Code: `services/gateway-config/routes/capability-gated-routes.yaml:27-35`
- E-2: Role not in allowed list → 403 from control-plane.

**Postconditions:** SQL executed scoped to workspace schema; audit event with `sql_admin.executed`.

---

### uc-pg-cdc-01 — Enable Postgres CDC to Kafka

**Title:** Workspace developer enables change-data-capture on a Postgres table

**Capabilities / Functionalities:** cap-pg-cdc / fn-pg-cdc-01, fn-pg-cdc-02, fn-pg-cdc-03, fn-isolation-02

**Primary actor:** Workspace developer

**Tenant context:** Capture config stored with `tenant_id`, `workspace_id`. WAL listener keyed to `(data_source_ref, tenant_id)`. Kafka topic name always embeds `tenantId.workspaceId`.

**Preconditions:**
- Plan includes `data.openwhisk.actions` (pg-captures capability gate).
  Code: `services/gateway-config/base/public-api-routing.yaml` (pg-captures family)
- A Postgres data source exists for this workspace.

**Trigger:** `POST /v1/workspaces/{workspaceId}/pg-captures`

**Main success flow:**

1. Control-plane creates a `pg_capture_configs` row with `status = 'active'`, `tenant_id`, `workspace_id`, `data_source_ref`.

2. `WalListenerManager.start()` polls active capture configs; starts one `PgWalListener` per `(data_source_ref, tenant_id)` pair.
   Code: `services/pg-cdc-bridge/src/WalListenerManager.mjs:20-26`

3. On WAL event: `WalEventDecoder` decodes the row change; `RouteFilter` filters against subscription.

4. `KafkaChangePublisher._allow(workspaceId)` enforces rate limit (default 1000 events/s per workspace using a sliding 1-second window).
   Code: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:34`

5. `KafkaChangePublisher.publish(captureConfig, decodedEvent, ...)` derives topic: `deriveTopic({ namespace: PG_CDC_KAFKA_TOPIC_PREFIX, tenantId, workspaceId })` → `${tenantId}.${workspaceId}.pg-changes`.
   Code: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:26-29`

6. Message published with CloudEvents headers: `ce-type: 'console.pg-capture.change'`, `ce-tenantid`, `ce-workspaceid`, `ce-source`.
   Code: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:40`

**Alternate flows:**

- A-1: `PgWalListener` reconnect failure → exponential backoff (initial 1 s, max 60 s).
  Code: `services/pg-cdc-bridge/src/WalListenerManager.mjs:26` (`_scheduleReconnect`)

**Error flows:**

- E-1: `assertValidTopicNamespace` fails on invalid prefix → `Error` thrown at startup; process aborts.
  Code: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:11-16`
- E-2: Rate limit exceeded → event dropped; `pg_cdc_events_rate_limited_total` metric incremented.
  Code: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:36`

**Postconditions:** CDC active; events flowing to `{tenantId}.{workspaceId}.pg-changes`; metrics `pg_cdc_publish_lag_seconds` tracked per workspace+table.

---

## Domain F — MongoDB Data API

---

### uc-mongo-01 — Enable MongoDB CDC with resume-token durability

**Title:** Workspace developer enables MongoDB change-stream CDC

**Capabilities / Functionalities:** cap-mongo-cdc / fn-mongo-cdc-01, fn-mongo-01, fn-isolation-05

**Primary actor:** Workspace developer

**Tenant context:** `mongo_capture_configs` row carries `tenant_id`, `workspace_id`. Audit INSERT always includes `tenant_id`, `workspace_id`, `actor_identity`.

**Preconditions:**
- Plan includes `data.openwhisk.actions` (mongo-captures family).
- MongoDB instance accessible.

**Trigger:** `POST /v1/realtime/workspaces/{workspaceId}/mongo-captures`

**Main success flow:**

1. Control-plane inserts `mongo_capture_configs` row with `tenant_id`, `workspace_id`, `status = 'active'`.

2. `ChangeStreamManager` (injected with `ResumeTokenStore`) starts the change stream. On restart, resumes from the stored token.
   Code: `services/mongo-cdc-bridge/src/index.mjs:23` (injection point)

3. On change event: `MongoChangeEventMapper` maps to CloudEvents; `KafkaChangePublisher` (mongo version) publishes.

4. On error: `statusUpdater` updates `mongo_capture_configs.status` and `last_error`.
   Code: `services/mongo-cdc-bridge/src/index.mjs:29`

5. `auditCallback` inserts into `mongo_capture_audit_log(capture_id, tenant_id, workspace_id, actor_identity, action, after_state)`.
   Code: `services/mongo-cdc-bridge/src/index.mjs:30`

**Error flows:**

- E-1: Missing resume token on restart → stream starts from current oplog position (potential gap).
  Code: `services/mongo-cdc-bridge/src/index.mjs:23` (ResumeTokenStore injection, medium confidence)

**Postconditions:** Change stream active; resume tokens persisted per `captureId`; audit log populated for every lifecycle event.

---

## Domain G — Object Storage

---

### uc-storage-01 — Create a bucket

**Title:** Tenant admin creates a storage bucket within the tenant namespace

**Capabilities / Functionalities:** cap-storage, cap-tenant-storage-context / fn-storage-01, fn-storage-02, fn-storage-ctx-01, fn-storage-ctx-02

**Primary actor:** Tenant admin or workspace developer

**Tenant context:** Bucket namespace is derived deterministically from `tenantId` + `tenantSlug`; namespaceBindingMode = `tenant_isolated`. Cross-tenant bucket access is not possible via the API.

**Preconditions:**
- Tenant plan includes `data.storage.bucket` capability.
- Tenant storage context state = `active`; `capabilityAvailable = true`; `providerStatus = ready`; `bucketProvisioningAllowed = true`.
- Tenant is not suspended or soft-deleted.

**Trigger:** `POST /v1/storage/buckets`

**Main success flow:**

1. Gateway checks `planCapabilityAnyOf: [data.storage.bucket]`.
   Code: `services/gateway-config/base/public-api-routing.yaml:322-330`

2. `buildTenantStorageContextRecord(...)` resolves all conditions: `capabilityAvailable`, `providerStatus`, `tenantState`. Sets `bucketProvisioningAllowed`.
   Code: `services/adapters/src/storage-tenant-context.mjs:150-260`

3. `buildTenantStorageQuotaAssignment(...)` reads `tenant.storage.buckets.max` from quota policy (default 8). Checks current count against limit.
   Code: `services/adapters/src/storage-tenant-context.mjs:128-148`

4. `deriveTenantStorageNamespace(tenantId, tenantSlug)` → `tctx-{slug}-{sha256(providerType:tenantId:tenant-storage-context)[:12]}` — ensures namespace uniqueness per tenant.
   Code: `services/adapters/src/storage-tenant-context.mjs:117-126`

5. Bucket created in tenant namespace; record written with `tenant_id`, quota snapshot recorded.

**Error flows:**

- E-1: Tenant suspended → `buildTenantStorageContextRecord` sets `bucketProvisioningAllowed = false`; 422 returned.
  Code: `services/adapters/src/storage-tenant-context.mjs:229`
- E-2: `capabilityAvailable = false` → `CAPABILITY_NOT_AVAILABLE`; 422 blocked (non-retryable).
  Code: `services/adapters/src/storage-tenant-context.mjs::TENANT_STORAGE_CONTEXT_ERROR_CODES`
- E-3: Bucket count at `tenant.storage.buckets.max` → `OPERATION_LIMIT_EXCEEDED`; 422.
- E-4: Missing `tenantId` in `deriveTenantStorageNamespace` → throws immediately.
  Code: `services/adapters/src/storage-tenant-context.mjs:117`

**Postconditions:** Bucket created in `tctx-{slug}-{hash}` namespace; quota snapshot updated; `tenant_storage_context.provisioned` audit event emitted.

---

### uc-storage-02 — Issue and rotate programmatic storage credentials

**Title:** Tenant admin issues then rotates S3-compatible programmatic credentials for a bucket

**Capabilities / Functionalities:** cap-storage / fn-storage-03

**Primary actor:** Tenant admin

**Tenant context:** Credentials scoped to tenant storage namespace. Revoked credentials become permanently inactive; values never returned after initial issuance.

**Preconditions:** Tenant storage context is `active`. Bucket exists.

**Trigger (issue):** `POST /v1/storage/credentials`
**Trigger (rotate):** `POST /v1/storage/credentials/{credentialId}/rotate`

**Main success flow (issue):**

1. `buildStorageProgrammaticCredentialSecretEnvelope(...)` creates a new credential record with version `1`, `secretRef` = `sha256`-derived reference, state `active`.
   Code: `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialSecretEnvelope`

2. Credential value returned once in the response. Subsequent `GET` on this resource never returns the value.
   Code: `apps/control-plane/src/functions-admin.mjs` — analogy: `secretGovernance.valueDisclosure: 'never_returned'`

**Main success flow (rotate):**

1. `rotateStorageProgrammaticCredential(credential)` increments version, generates new `secretRef` with fresh SHA-256 suffix.
   Code: `services/adapters/src/storage-programmatic-credentials.mjs::rotateStorageProgrammaticCredential`

2. `rotateTenantStorageContextCredential(...)` emits `tenant_storage_context.{transition}` event with audit envelope including `actorUserId`, `reason`.
   Code: `services/adapters/src/storage-tenant-context.mjs:312-345`

**Error flows:**

- E-1: Tenant suspended → credential health = `revoked`; new credentials cannot be issued.
  Code: `services/adapters/src/storage-tenant-context.mjs:65-78`
- E-2: Tenant soft_deleted → credential health = `permanently_revoked`.

**Postconditions:** New credential at incremented version; old credential revoked; audit event emitted with `actorUserId`.

---

### uc-storage-03 — Import objects into a bucket with manifest

**Title:** Workspace developer imports objects into a storage bucket using an import manifest

**Capabilities / Functionalities:** cap-storage / fn-storage-04

**Primary actor:** Workspace developer

**Tenant context:** Import scoped to the calling tenant's bucket namespace. `previewStorageImportResult` enforces the operation limit.

**Preconditions:** Tenant storage context active; target bucket exists; `data.storage.bucket` in plan.

**Trigger:** `POST /v1/storage/buckets/{bucketId}/import`

**Main success flow:**

1. `previewStorageImportResult(manifest, context)` checks `objectCount > appliedLimit`; `appliedLimit` is the lesser of platform limit and optional tenant-override.
   Code: `apps/control-plane/src/storage-admin.mjs:475-539`

2. For each manifest entry: conflict policy applied (skip / overwrite / rename); object written.

3. Final outcome:
   - All succeeded → `imported`
   - `failedCount > 0 && importedCount > 0` → `partial_failure`
   - `objectCount = 0` → `export_empty_result`

**Error flows:**

- E-1: `objectCount > appliedLimit` → `OPERATION_LIMIT_EXCEEDED`; 422 before any objects written.
  Code: `apps/control-plane/src/storage-admin.mjs::checkImportExportOperationLimit`

**Postconditions:** Objects written to tenant-scoped bucket; partial failure records returned for failed entries.

---

## Domain H — Realtime / WebSocket

---

### uc-realtime-01 — Open a realtime WebSocket subscription

**Title:** Application client opens a realtime WebSocket session to subscribe to workspace events

**Capabilities / Functionalities:** cap-realtime, cap-token-validation / fn-realtime-01, fn-realtime-05, fn-isolation-01

**Primary actor:** External application (authenticated, with `realtime` capability in plan)

**Tenant context:** Session record in `realtime_sessions` carries `tenant_id`, `workspace_id`. All events published to the session are checked against `session.tenantId === event.tenantId && session.workspaceId === event.workspaceId`.

**Preconditions:**
- Plan includes `realtime` capability.
- Bearer JWT is valid and contains `tenant_id` + workspace in `authorizedWorkspaces`.

**Trigger:** WebSocket upgrade to `wss://{host}/v1/websockets` with `Authorization: Bearer <jwt>` (or query parameter).

**Main success flow:**

1. Gateway capability gate checks `realtime` for `/v1/workspaces/*/realtime*` and `/v1/events/subscribe`.
   Code: `services/gateway-config/routes/capability-gated-routes.yaml:21-26`

2. `createSession(bearerToken, workspaceId, channelType, db)`:
   a. `validateToken(bearerToken)` → normalized claims including `tenant_id`, `authorizedWorkspaces`.
      Code: `services/realtime-gateway/src/auth/session-manager.mjs:146`
   b. `checkScopes(claims, workspaceId, channelType, db)` → loads `realtime_scope_channel_mappings` for `(tenantId, workspaceId)`. Cache key: `{tenantId}:{workspaceId}` (cross-tenant leak impossible).
      Code: `services/realtime-gateway/src/auth/scope-checker.mjs:30-44`
   c. If `!scopeCheck.allowed` → throws `INSUFFICIENT_SCOPE`.
      Code: `services/realtime-gateway/src/auth/session-manager.mjs:148-153`

3. `insertSessionRow(db, session)`:
   ```sql
   INSERT INTO realtime_sessions (id, tenant_id, workspace_id, actor_identity, token_jti, ...)
   VALUES ($1, $2, $3, ...)
   ```
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:20-45`

4. `startPolling(db, session)` starts re-validation interval at `SCOPE_REVALIDATION_INTERVAL_SECONDS`.
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:91-143`

5. Session map entry created; `status = 'ACTIVE'`.

6. For every inbound event to publish: `guardEvent(event, session)` checks strict equality.
   Code: `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs:1-4`

**Error flows:**

- E-1: Missing `tenant_id` in claims → `checkScopes` returns `{ allowed: false, missingScope: 'tenant_id' }` → 403.
  Code: `services/realtime-gateway/src/auth/session-manager.mjs:148-153` (throws INSUFFICIENT_SCOPE)
- E-2: Workspace not in `authorizedWorkspaces` → `{ allowed: false, missingScope: 'workspace-access' }`.
- E-3: Cross-tenant event injection → `guardEvent` returns `false`; event blocked.
  Code: `services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs:1-4`

**Postconditions:** Session active; `realtime_sessions` row inserted; polling timer running.

---

### uc-realtime-02 — Token expiry triggers session suspension

**Title:** Polling detects expired/revoked token and suspends the WebSocket session

**Capabilities / Functionalities:** cap-realtime / fn-realtime-02

**Primary actor:** System (polling interval job)

**Tenant context:** `session.tenantId` and `session.workspaceId` used in `suspendSession` audit event.

**Preconditions:** Active session exists; token has since expired or been revoked in Keycloak.

**Trigger:** `SCOPE_REVALIDATION_INTERVAL_SECONDS` interval fires.

**Main success flow:**

1. Polling callback checks `now >= tokenExpiresAt + graceMs` → suspends with reason `TOKEN_EXPIRED`.
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:103-107`

2. If not expired: `introspectTokenFn(session.token)` → if `!introspection.active` → suspend `SCOPE_REVOKED` or `TOKEN_EXPIRED`.
   Code: line 110-116

3. Re-checks scopes; if scope revoked → `suspendSession(db, session, 'SCOPE_REVOKED')`.
   Code: line 118-129

4. `suspendSession` → `updateSessionStatus(db, session, 'SUSPENDED')` + `publishAuthDecisionFn({ action: 'SUSPENDED', tenantId, workspaceId, suspensionReason })` to Kafka.
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:62-82`

5. `realtime_sessions` row updated: `status = 'SUSPENDED'`, `last_validated_at = now`.

**Postconditions:** Session `SUSPENDED`; `SUSPENDED` audit event on Kafka `console.realtime.subscription-lifecycle`; client receives connection closure.

---

### uc-realtime-03 — Resume a suspended realtime session

**Title:** Client presents a new token to resume a suspended WebSocket session

**Capabilities / Functionalities:** cap-realtime / fn-realtime-03

**Primary actor:** Authenticated client

**Tenant context:** Session's `tenantId` and `workspaceId` unchanged; new token must carry same `tenant_id`.

**Preconditions:** Session exists and is in `SUSPENDED` status; new valid Bearer JWT available.

**Trigger:** Client sends a token refresh message with a new Bearer JWT to the existing session.

**Main success flow:**

1. `refreshToken(sessionId, newBearerToken, db)` → `validateToken(newBearerToken)` with full JWKS verification.
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:185-232`

2. Session claims updated; `status = 'ACTIVE'`; polling interval restarted.

3. Prior status was `SUSPENDED` → `publishAuthDecisionFn({ action: 'RESUMED', tenantId, workspaceId })` published to Kafka.
   Code: `services/realtime-gateway/src/auth/session-manager.mjs:216-229`

4. `realtime_sessions` row updated: `token_jti`, `token_expires_at`, `status = 'ACTIVE'`, `last_validated_at`.
   Code: line 202-212

**Error flows:**

- E-1: Unknown `sessionId` → `throw new Error('Unknown session ${sessionId}')`.
  Code: `services/realtime-gateway/src/auth/session-manager.mjs:188-190`
- E-2: New token is already expired → `validateToken` throws `TOKEN_EXPIRED`.

**Postconditions:** Session `ACTIVE`; `RESUMED` audit event on Kafka (only if prior status was `SUSPENDED`).

---

## Domain I — Events / Kafka

---

### uc-events-01 — Publish a CloudEvent to a workspace Kafka topic

**Title:** Application publishes a CloudEvent to a workspace-scoped Kafka topic

**Capabilities / Functionalities:** cap-events / fn-events-01, fn-events-02

**Primary actor:** External application / service account

**Tenant context:** Topic creation enforces `{tenantId}.{workspaceId}` in topic name via naming policy (analogous to CDC naming). The `events` family has `tenantBinding: required` and `workspaceBinding: required`.

**Preconditions:**
- Plan includes `data.kafka.topics`.
- Topic exists for this workspace.
- Actor has publish scope.

**Trigger:** `POST /v1/events/topics/{resourceId}/publish` with `Content-Type: application/cloudevents+json`.

**Main success flow:**

1. Gateway checks `planCapabilityAnyOf: [data.kafka.topics]`; validates `Content-Type` against `event_gateway` profile (allows `application/cloudevents+json`).
   Code: `services/gateway-config/base/public-api-routing.yaml:304-317` (events family), `:117-120` (event_gateway profile)

2. Rate limit: 180 req/min burst 60 (`event_gateway` QoS profile).
   Code: `services/gateway-config/base/public-api-routing.yaml:173-178`

3. Event-gateway validates the CloudEvent structure; routes to workspace Kafka topic.

4. Kafka audit context fields (`target_tenant_id`, `target_workspace_id`) recorded in admin event.
   Code: `apps/control-plane/src/events-admin.mjs:40-47` (`KAFKA_ADMIN_AUDIT_CONTEXT_FIELDS`)

**Error flows:**

- E-1: Plan lacks `data.kafka.topics` → 403 at gateway.
- E-2: Quota `workspace.kafka_topics.max` exceeded → `quota.hard_limit_exceeded` audit event.
  Code: `services/internal-contracts/src/index.mjs::getHardLimitAuditContract` (fn-quotas-04)

**Postconditions:** Event published; delivery confirmed; quota snapshot updated.

---

### uc-events-02 — Create a Kafka-topic trigger for a function

**Title:** Workspace developer attaches a Kafka trigger to a function

**Capabilities / Functionalities:** cap-events, cap-functions / fn-events-02, fn-functions-05

**Primary actor:** Workspace developer

**Tenant context:** Trigger scoped to workspace Kafka topic; function must belong to the same workspace/tenant.

**Preconditions:** Function exists; Kafka topic exists in workspace; plan includes `data.kafka.topics` and `data.openwhisk.actions`.

**Trigger:** `POST /v1/functions/{functionId}/kafka-trigger`

**Main success flow:**

1. Gateway function family checks `planCapabilityAnyOf: [data.openwhisk.actions]`.
   Code: `services/gateway-config/base/public-api-routing.yaml:319-330` (functions family)

2. Control-plane validates `SUPPORTED_FUNCTION_TRIGGER_KINDS` includes `kafka_trigger`.
   Code: `apps/control-plane/src/functions-admin.mjs:45` (`SUPPORTED_FUNCTION_TRIGGER_KINDS = OPENWHISK_SUPPORTED_TRIGGER_KINDS`)

3. Trigger record created linking `functionId` → workspace Kafka topic; delivery mode and payload mode from `KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES`.
   Code: `apps/control-plane/src/events-admin.mjs:129-143`

4. Quota enforcement checked (function count dimension).

**Postconditions:** Kafka trigger active; function invoked on each matching message.

---

## Domain J — Functions / Serverless

---

### uc-fn-01 — Deploy a serverless function action

**Title:** Workspace developer deploys an OpenWhisk action with immutable versioning

**Capabilities / Functionalities:** cap-functions / fn-functions-01, fn-functions-04

**Primary actor:** Workspace developer

**Tenant context:** All function operations scoped to `(tenantId, workspaceId)` via gateway propagated headers. Function quota dimensions enforced per tenant+workspace.

**Preconditions:**
- Plan includes `data.openwhisk.actions`.
- `functions_public` capability required only for public invocation.
- Function count quota not exceeded.

**Trigger:** `POST /v1/functions` (create action) or `POST /v1/functions/{functionId}/versions` (new version).

**Main success flow:**

1. Gateway checks `planCapabilityAnyOf: [data.openwhisk.actions]`.
   Code: `services/gateway-config/base/public-api-routing.yaml` (functions family)

2. Control-plane validates `source.kind` ∈ `SUPPORTED_FUNCTION_SOURCE_KINDS` and `runtime` ∈ `SUPPORTED_FUNCTION_RUNTIMES`.
   Code: `apps/control-plane/src/functions-admin.mjs:44-46`

3. OpenWhisk action created via `openwhisk-admin` adapter; `lifecycleGovernance.immutableVersions: true` — the version is sealed.
   Code: `apps/control-plane/src/functions-admin.mjs` (`summarizeFunctionsAdminSurface` returns `immutableVersions: true`)

4. Quota enforcement: `emitQuotaEnforcementEvent(...)` checks `function_count` dimension.
   Code: `apps/control-plane/src/functions-admin.mjs::emitQuotaEnforcementEvent`

5. `emitDeploymentAuditEvent(...)` emits audit event with `tenantId`, `workspaceId`, `functionId`, `version`.

**Error flows:**

- E-1: Function count quota exceeded → `quota.hard_limit_exceeded` to `console.quota.hard_limit.blocked`; write rejected.
  Code: `apps/control-plane/src/functions-admin.mjs::emitQuotaEnforcementEvent` (fn-functions-04)

**Postconditions:** Function version immutably recorded; quota snapshot updated; deployment audit event emitted.

---

### uc-fn-02 — Invoke a function synchronously

**Title:** External application invokes a function synchronously via the console-backend envelope

**Capabilities / Functionalities:** cap-functions / fn-functions-02

**Primary actor:** External application (with `functions_public` capability if publicly invoked)

**Tenant context:** Invocation envelope carries `tenantId`, `workspaceId`, `correlationId` in activation annotation.

**Preconditions:**
- `functions_public` capability in plan for public invocations; or console-backend invocation for internal.
- `responseMode` and `triggerContext.kind = 'direct'` specified.

**Trigger:** `POST /v1/functions/{functionId}/invoke`

**Main success flow:**

1. Gateway capability gate checks `functions_public` for `POST /v1/functions/*/invoke`.
   Code: `services/gateway-config/routes/capability-gated-routes.yaml:39-41`

2. `validateConsoleBackendInvocationRequest(request)` validates `responseMode`, `tenantId`, `workspaceId`, `triggerContext.kind === 'direct'`.
   Code: `apps/control-plane/src/functions-admin.mjs` (`validateConsoleBackendInvocationRequest` imported from openwhisk-admin)

3. `buildConsoleBackendInvocationEnvelope(...)` assembles `{ tenantId, workspaceId, correlationId, triggerContext }` as activation annotation.
   Code: `apps/control-plane/src/functions-admin.mjs:` (re-exported from openwhisk-admin)

4. OpenWhisk invocation dispatched; synchronous response awaited.

5. `emitAdminActionAuditEvent(...)` records invocation.

**Error flows:**

- E-1: `functions_public` capability absent → 403 at gateway.
  Code: `services/gateway-config/routes/capability-gated-routes.yaml:39-41`
- E-2: Missing `responseMode` → `validateConsoleBackendInvocationRequest` throws.
- E-3: `triggerContext.kind !== 'direct'` → throws.

**Postconditions:** Function executed; activation record available; audit event with `tenantId`, `workspaceId`, `functionId`.

---

### uc-fn-03 — Create a cron trigger for a function

**Title:** Workspace developer creates a cron trigger connecting a function to the scheduling engine

**Capabilities / Functionalities:** cap-functions, cap-scheduling / fn-functions-05, fn-scheduling-01, fn-scheduling-04, fn-scheduling-05

**Primary actor:** Workspace developer

**Tenant context:** Scheduling job record carries `tenant_id`, `workspace_id`. Config waterfall resolves per workspace then tenant. Quota check is `WHERE tenant_id = $1 AND workspace_id = $2`.

**Preconditions:**
- Function exists; plan includes `data.openwhisk.actions`.
- Scheduling enabled for the workspace (config waterfall: workspace → tenant → env default `SCHEDULING_ENABLED_BY_DEFAULT`).
  Code: `services/scheduling-engine/src/config-model.mjs:22-28`

**Trigger:** `POST /v1/functions/{functionId}/cron-trigger`

**Main success flow:**

1. `getConfig(pg, tenantId, workspaceId)` resolves configuration waterfall:
   - Workspace-level row → if missing → tenant-level row (`workspace_id IS NULL`) → if missing → env defaults.
   Code: `services/scheduling-engine/src/config-model.mjs:3-28`

2. `isSchedulingEnabled(config)` → if `false`, reject with 422.
   Code: `services/scheduling-engine/src/config-model.mjs:56-58`

3. `assertCronFloor(expr, config.min_interval_seconds)` validates cron expression does not exceed minimum interval (default 60 s).
   Code: `services/scheduling-engine/src/quota.mjs:15-17`

4. `getActiveJobCount(pg, tenantId, workspaceId)` → `SELECT COUNT WHERE tenant_id=$1 AND workspace_id=$2 AND status='active'`.
   Code: `services/scheduling-engine/src/quota.mjs:19-29`

5. `checkJobCreationQuota(currentActiveCount, config.max_active_jobs)` → if `currentActiveCount >= maxActiveJobs` → reject.
   Code: `services/scheduling-engine/src/quota.mjs:3-9`

6. `buildJobRecord(input, context)` creates the job record with `tenant_id`, `workspace_id`, `cron_expression`, `target_action`, `next_run_at`.
   Code: `services/scheduling-engine/src/job-model.mjs:11-31`

7. Job record inserted; `status = 'active'`.

**Error flows:**

- E-1: Scheduling disabled → reject.
- E-2: Cron interval below floor → `assertCronFloor` throws.
- E-3: Quota exceeded → `checkJobCreationQuota` returns `{ allowed: false }` → 422 + `quota.hard_limit_exceeded` audit event.

**Postconditions:** Scheduled job in `active` status; `next_run_at` computed; quota count incremented.

---

### uc-fn-04 — Import a function bundle (scoped)

**Title:** Workspace developer imports a function bundle (actions, packages, triggers, rules)

**Capabilities / Functionalities:** cap-functions / fn-functions-06

**Primary actor:** Workspace developer

**Tenant context:** Import scope validated by `buildScopeValidatedImportRequest`; bundle scoped to `(tenantId, workspaceId)`.

**Preconditions:** Plan includes `data.openwhisk.actions`; bundle structure is valid.

**Trigger:** `POST /v1/functions/import`

**Main success flow:**

1. `buildScopeValidatedImportRequest(request, context)` binds the import to the calling workspace/tenant.
   Code: `apps/control-plane/src/functions-admin.mjs` (re-export from functions-import-export)

2. `validateImportBundle(bundle)` checks bundle structure; returns `IMPORT_ERROR_CODES` on failure.
   Code: `apps/control-plane/src/functions-admin.mjs` (re-export)

3. `WEB_ACTION_VISIBILITY_STATES` governs exposure visibility of web actions in the bundle.

4. Each action, package, trigger, rule provisioned in OpenWhisk; credential references redacted.

**Error flows:**

- E-1: Invalid bundle structure → `IMPORT_ERROR_CODES` response with detail.
- E-2: Actor's `tenantId` does not match bundle's scope → `buildScopeValidatedImportRequest` rejects.

**Postconditions:** Functions/packages/triggers/rules created in workspace OpenWhisk namespace; audit event per imported resource.

---

## Domain K — Webhooks

---

### uc-wh-01 — Create a webhook subscription

**Title:** Workspace developer creates a webhook subscription with SSRF guard validation

**Capabilities / Functionalities:** cap-webhooks / fn-webhooks-01, fn-webhooks-02, fn-isolation-03

**Primary actor:** Workspace developer

**Tenant context:** Subscription record carries `tenant_id`, `workspace_id`, `created_by`. Table indexed on `(tenant_id, workspace_id)`.

**Preconditions:**
- Plan includes `webhooks` capability.
- Target URL is reachable and passes SSRF checks.

**Trigger:** `POST /v1/workspaces/{workspaceId}/webhooks`

**Main success flow:**

1. Gateway capability gate checks `webhooks` for `/v1/workspaces/*/webhooks*`.
   Code: `services/gateway-config/routes/capability-gated-routes.yaml:16-19`

2. `validateSubscriptionInput({ targetUrl, eventTypes })`:
   a. `new URL(targetUrl)` parse; `protocol !== 'https:'` → `INVALID_URL`.
      Code: `services/webhook-engine/src/webhook-subscription.mjs:159-169`
   b. `normalizeNumericIPv4(hostname)` to detect IP literals in decimal/octal/hex/1-4 part inet_aton encoding.
      Code: `services/webhook-engine/src/webhook-subscription.mjs:22-68`
   c. If IP literal: `isPrivateHostname` → `isBlockedIPv4` checks 0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16.
      Code: `services/webhook-engine/src/webhook-subscription.mjs:75-85`
   d. If hostname: DNS `lookup(hostname, { all: true })` → all A/AAAA addresses checked with `isBlockedIp(ip)`.
      Code: `services/webhook-engine/src/webhook-subscription.mjs:187-206`
   e. `isBlockedIp(ip)` also checks `::1`, `::`, `::ffff:` (IPv4-mapped), `fc00::/7` (ULA), `fe80::/10` (link-local).
      Code: `services/webhook-engine/src/webhook-subscription.mjs:91-120`
   f. `eventTypes` validated against event catalogue.
      Code: `services/webhook-engine/src/webhook-subscription.mjs:208-212`

3. `buildSubscriptionRecord(input, context)`:
   - `id = crypto.randomUUID()`
   - `tenant_id = context.tenantId`, `workspace_id = context.workspaceId`, `created_by = context.actorId`
   - `status = 'active'`, `max_consecutive_failures = context.maxConsecutiveFailures ?? 5`
   Code: `services/webhook-engine/src/webhook-subscription.mjs:216-235`

4. Record persisted; indexed on `(tenant_id, workspace_id)`.
   Code: `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17`

**Error flows:**

- E-1: HTTP (non-HTTPS) URL → `INVALID_URL`.
- E-2: IP literal resolves to private range → `INVALID_URL`.
- E-3: DNS resolution fails → `INVALID_URL` (fail-closed).
  Code: `services/webhook-engine/src/webhook-subscription.mjs:190-196`
- E-4: DNS resolves to blocked IP → `INVALID_URL`.
- E-5: `0x7f000001` (loopback hex) → `normalizeNumericIPv4` → `127.0.0.1` → blocked.
- E-6: `::ffff:10.0.0.1` (IPv4-mapped private) → `isBlockedIp` returns true.
  Code: `services/webhook-engine/src/webhook-subscription.mjs:99-101`
- E-7: Unknown event types → `INVALID_EVENT_TYPES`.
- E-8: Plan lacks `webhooks` capability → 403 at gateway before any validation.

**Postconditions:** Subscription `active` in DB; indexed by `(tenant_id, workspace_id)`; no other tenant can access this record.

---

### uc-wh-02 — Pause and re-activate a webhook subscription

**Title:** Workspace developer pauses an active webhook, then reactivates it

**Capabilities / Functionalities:** cap-webhooks / fn-webhooks-03

**Primary actor:** Workspace developer

**Tenant context:** All queries to `webhook_subscriptions` filter by `(tenant_id, workspace_id)`.

**Preconditions:** Subscription exists and is `active`.

**Trigger (pause):** `PATCH /v1/workspaces/{workspaceId}/webhooks/{subscriptionId}` with `status: 'paused'`.
**Trigger (reactivate):** Same endpoint with `status: 'active'`.

**Main success flow (pause → active):**

1. Load subscription by `(tenant_id, workspace_id, subscriptionId)`.

2. `canTransition('active', 'paused')` → `TRANSITIONS['active'].has('paused')` = `true`.
   Code: `services/webhook-engine/src/webhook-subscription.mjs:237-245`

3. `applyStatusTransition(subscription, 'paused')` → `{ ...subscription, status: 'paused', updated_at: now }`.
   Code: `services/webhook-engine/src/webhook-subscription.mjs:248-255`

4. Record persisted.

5. Later: `canTransition('paused', 'active')` = `true` → reactivation.

**Error flows:**

- E-1: `canTransition('disabled', 'paused')` = `false` (disabled can only go to active or deleted) → `INVALID_STATUS_TRANSITION`.
  Code: `services/webhook-engine/src/webhook-subscription.mjs:244` (`TRANSITIONS.disabled` = `{ active, deleted }`)
- E-2: Attempt to transition from `deleted` → any state → `INVALID_STATUS_TRANSITION` (`deleted` transitions = empty set).

**Postconditions:** Subscription state updated; delivery attempts pause (or resume). Soft-delete via `softDelete` sets `deleted_at` AND `status = 'deleted'`.

---

## Domain L — Scheduling

---

### uc-sched-01 — Create a cron scheduled job

**Title:** Workspace developer creates a cron job targeting an OpenWhisk action

**Capabilities / Functionalities:** cap-scheduling / fn-scheduling-01, fn-scheduling-04, fn-scheduling-05

(This use case shares the same flow as uc-fn-03. See Domain J for the complete flow. The scheduling-specific elements are summarized here for completeness.)

**Primary actor:** Workspace developer

**Tenant context:** `scheduling_configurations` and `scheduled_jobs` both carry `(tenant_id, workspace_id)`. Cross-workspace job access is impossible.

**Preconditions:** Scheduling enabled; quota below limit; cron interval above floor.

**Main success flow steps unique to scheduling:**

1. Config resolved via `getConfig(pg, tenantId, workspaceId)` — three-level waterfall.
   Code: `services/scheduling-engine/src/config-model.mjs:3-28`

2. `upsertConfig` uses `ON CONFLICT (tenant_id, workspace_id)` for idempotent updates.
   Code: `services/scheduling-engine/src/config-model.mjs:40-53`

3. `buildJobRecord(input, context)` sets `next_run_at = nextRunAt(cronExpression, now)`.
   Code: `services/scheduling-engine/src/job-model.mjs:11-31`

**Postconditions:** `scheduled_jobs` row created; `scheduled_executions` records created on each trigger.

---

### uc-sched-02 — Automatic job erroring on consecutive failures

**Title:** Scheduling engine auto-errors a job after max consecutive failures

**Capabilities / Functionalities:** cap-scheduling / fn-scheduling-02, fn-scheduling-03

**Primary actor:** System (scheduling-engine runner)

**Tenant context:** Failure increment and state transition operate on the job record's `(tenant_id, workspace_id)`. No cross-tenant data accessed.

**Preconditions:** Job is `active`; previous executions have failed `N-1` times.

**Trigger:** Execution of the job's cron trigger fails.

**Main success flow:**

1. `incrementFailureCount(job)` → `consecutive_failure_count += 1`.
   Code: `services/scheduling-engine/src/job-model.mjs:49-58`

2. If `consecutive_failure_count >= job.max_consecutive_failures` → `status = 'errored'`.
   Code: `services/scheduling-engine/src/job-model.mjs:51`

3. `canTransition('active', 'errored')` = `true` (per `VALID_TRANSITIONS`).
   Code: `services/scheduling-engine/src/job-model.mjs:4-9`

4. Job record persisted with `status = 'errored'`.

**Alternate flows:**

- A-1: Execution succeeds → `resetFailureCount(job)` → `consecutive_failure_count = 0`.
  Code: `services/scheduling-engine/src/job-model.mjs:60-66`

**Error flows:**

- E-1: Attempt to transition `errored → active` → `canTransition('errored', 'active')` = `false` → throws.
  Code: `services/scheduling-engine/src/job-model.mjs:37-40` (`VALID_TRANSITIONS.errored` only contains `deleted`)

**Postconditions:** Job in `errored` state; no further executions unless manually resolved (only path is `deleted`).

---

## Domain M — Backup & Restore

---

### uc-backup-01 — Trigger an on-demand backup

**Title:** Tenant owner triggers an on-demand backup of a database instance

**Capabilities / Functionalities:** cap-backup-restore / fn-backup-01, fn-backup-03

**Primary actor:** Tenant owner (scope `backup:write:own`)

**Tenant context:** `backup:write:own` restricts actor to operate only on their own `tenantId`. The scope check `token.tenantId !== tenant_id → 403` is explicit.

**Preconditions:**
- `BACKUP_ENABLED = true` (env variable).
- Actor has `backup:write:own` or `backup:write:global` scope in token.
- Component type supports `triggerBackup` capability.
- No concurrent active backup operation for `(tenant_id, component_type, instance_id)`.

**Trigger:** `POST /v1/admin/backup/trigger` with `{ tenant_id, component_type, instance_id }`.

**Main success flow:**

1. `extractToken(params.__ow_headers)` → `validateToken(rawToken)` performs JWKS JWT validation.
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:50-53`

2. Scope check: must have `backup:write:own` or `backup:write:global`.
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:56-60`

3. Cross-tenant guard: `!hasWriteGlobal && token.tenantId !== tenant_id → 403`.
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:97-99`

4. Adapter capability check: `getCapabilities(component_type).triggerBackup` must be `true`.
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:103-107`

5. Deployment check: `BACKUP_ENABLED !== false`.
   Code: line 110-113

6. Concurrent operation check: `repo.findActive(tenant_id, component_type, instance_id, 'backup')` → if found → 409.
   Code: line 116-120

7. `repo.create({ type: 'backup', tenantId, componentType, instanceId, requesterId, requesterRole })` creates operation record.
   Code: line 123-130

8. `emitAuditEvent({ eventType: 'backup.requested', result: 'accepted', tenantId, actorId, ... })` (fire-and-forget).
   Code: line 133-144

9. `dispatcher.dispatch(operation.id)` dispatches async (non-blocking, errors swallowed).
   Code: line 147-149

10. Returns HTTP 202: `{ operation_id, status: 'accepted', accepted_at }`.

**Postconditions:** Operation record created; `backup.requested` audit event; async backup dispatch initiated.

**Linked:** bbx-backup-trigger

---

### uc-backup-02 — Cross-tenant backup denied (IDOR probe)

**Title:** Actor with `backup:write:own` attempts to trigger backup on a different tenant's data

**Capabilities / Functionalities:** cap-backup-restore / fn-backup-02, fn-backup-03

**Primary actor:** Malicious tenant owner (scope `backup:write:own` only)

**Tenant context:** Actor's `token.tenantId = 'tenant_A'`; request body specifies `tenant_id = 'tenant_B'`.

**Preconditions:** Valid JWT for `tenant_A`; request specifies `tenant_id = 'tenant_B'`.

**Trigger:** `POST /v1/admin/backup/trigger` with `tenant_id = 'tenant_B'`.

**Main success flow (attack blocked):**

1. Steps 1–2 from uc-backup-01 pass (valid token, has `backup:write:own`).

2. Cross-tenant check: `!hasWriteGlobal` = `true` AND `token.tenantId ('tenant_A') !== tenant_id ('tenant_B')` → true → 403.
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:97-99`

3. `emitRejection('cross_tenant_not_allowed', ...)` fires audit event (fire-and-forget `void`).
   Code: `services/backup-status/src/operations/trigger-backup.action.ts:79-94`

4. `backup.rejected` audit event carries `tenantId = 'tenant_B'`, `actorId`, `rejectionReason: 'cross_tenant_not_allowed'`.

**Postconditions:** 403 returned; no backup operation created; `backup.rejected` audit event emitted; tenant B data not accessed.

---

## Domain N — Secrets Management

---

### uc-secrets-01 — Vault audit log tailed and published to Kafka

**Title:** Secret audit handler tails Vault audit log and publishes sanitized events

**Capabilities / Functionalities:** cap-secrets / fn-secrets-01

**Primary actor:** System (secret-audit-handler daemon)

**Tenant context:** Vault audit events may contain per-tenant secret access records. `sanitize(entry)` strips sensitive field values before publishing to Kafka.

**Preconditions:**
- `KAFKA_BROKERS` environment variable is set (non-empty).
- `VAULT_AUDIT_LOG_PATH` is accessible.
- Kafka broker reachable.

**Trigger:** Process startup.

**Main success flow:**

1. `brokers = (KAFKA_BROKERS ?? '').split(',').filter(Boolean)` — if empty → `process.exit(1)`.
   Code: `services/secret-audit-handler/src/index.mjs:8-11`

2. `createPublisher({ brokers, topic: SECRET_AUDIT_KAFKA_TOPIC })` → `publisher.connect()`.
   Code: `services/secret-audit-handler/src/index.mjs:14-20`

3. `for await (const entry of createLogTailer(filePath))` → continuous tail of `VAULT_AUDIT_LOG_PATH`.
   Code: `services/secret-audit-handler/src/index.mjs:31`

4. `sanitize(entry)` removes sensitive fields from the Vault entry.
   Code: `services/secret-audit-handler/src/index.mjs:32`

5. `publisher.publishAuditEvent(cleaned)` → Kafka topic `console.secrets.audit`.
   Code: `services/secret-audit-handler/src/index.mjs:33`

6. SIGTERM/SIGINT → `publisher.disconnect()` → `process.exit(0)`.

**Error flows:**

- E-1: `KAFKA_BROKERS` empty at startup → `process.exit(1)` before starting the tailer.
  Code: `services/secret-audit-handler/src/index.mjs:9-11`
- E-2: Kafka `connect()` failure → `process.exit(1)`.
  Code: `services/secret-audit-handler/src/index.mjs:18-21`

**Postconditions:** Sanitized Vault events flowing to `console.secrets.audit` topic; sensitive values never published.

---

## Domain O — Quotas, Plans & Capabilities

---

### uc-quota-01 — Plan capability gate blocks ungated API family

**Title:** Tenant on starter plan (without SSO) attempts to access IAM admin routes

**Capabilities / Functionalities:** cap-quotas-plans, cap-iam-admin / fn-quotas-03, fn-iam-03

**Primary actor:** Tenant admin on a plan without `identity.sso.oidc`

**Tenant context:** `X-Plan-Id` propagated by gateway from JWT claims. Gateway enforces `planCapabilityAnyOf` per family.

**Preconditions:** Tenant plan does not include `identity.sso.oidc`.

**Trigger:** `POST /v1/admin/iam/realms` (or any IAM family route).

**Main success flow (blocked):**

1. Gateway resolves `planCapabilityAnyOf: [identity.sso.oidc]` for the `iam` family.
   Code: `services/gateway-config/base/public-api-routing.yaml:273-274`

2. JWT `X-Plan-Id` does not include `identity.sso.oidc` in the resolved capability set.

3. Gateway returns 403 with `capabilityEnforcementDeniedEvent` audit event (security, extended retention).
   Code: `services/audit/src/contract-boundary.mjs` (`capabilityEnforcementDeniedEvent`)

4. Request never reaches control-plane.

**This pattern applies to all gated families:**
- `postgres` / `mongo`: `data.postgresql.*` / `data.mongodb.*`
- `events`: `data.kafka.topics`
- `functions`: `data.openwhisk.actions`
- `storage`: `data.storage.bucket`
- `metrics`: `observability.metrics.basic`

Code: `services/gateway-config/base/public-api-routing.yaml:273-360`

**Postconditions:** 403 returned; `capabilityEnforcementDeniedEvent` written to security audit log with extended retention.

---

### uc-quota-02 — Hard quota limit rejects write and emits audit event

**Title:** Workspace developer attempts to create a scheduled job beyond the quota limit

**Capabilities / Functionalities:** cap-quotas-plans, cap-scheduling / fn-quotas-04, fn-scheduling-01

**Primary actor:** Workspace developer

**Tenant context:** Quota count scoped to `(tenant_id, workspace_id)`.

**Preconditions:** Current active job count equals `max_active_jobs`.

**Trigger:** `POST /v1/workspaces/{workspaceId}/schedules`

**Main success flow (blocked):**

1. `getActiveJobCount(pg, tenantId, workspaceId)` returns `currentCount = maxActiveJobs`.
   Code: `services/scheduling-engine/src/quota.mjs:19-29`

2. `checkJobCreationQuota(currentCount, maxActiveJobs)` → `{ allowed: false, reason: 'Workspace has reached...' }`.
   Code: `services/scheduling-engine/src/quota.mjs:3-9`

3. Service rejects write; emits `quota.hard_limit_exceeded` audit event to `console.quota.hard_limit.blocked` Kafka topic.
   Code: `services/internal-contracts/src/index.mjs::getHardLimitAuditContract` (fn-quotas-04)

4. HTTP 422 returned with `reason` in body.

**Postconditions:** No job created; quota hard-limit audit event on `console.quota.hard_limit.blocked`.

---

## Domain P — Audit & Observability

---

### uc-audit-01 — Query tenant audit events (scoped, paginated)

**Title:** Tenant admin queries audit events for their tenant with cursor-based pagination

**Capabilities / Functionalities:** cap-audit / fn-audit-01, fn-audit-02

**Primary actor:** Tenant admin

**Tenant context:** `assertScopeBinding` enforces that `tenantId` in query equals `context.tenantId`; cross-tenant query blocked.

**Preconditions:** Actor has `tenant_admin` role. Audit events have been written for this tenant.

**Trigger:** `GET /v1/admin/audit/events?scope=tenant&tenantId={tenantId}&limit=50&cursor=...`

**Main success flow:**

1. `normalizeAuditRecordQuery('tenant', context, params)` validates scope.
   Code: `apps/control-plane/src/observability-audit-query.mjs:115-130`

2. `assertScopeBinding(scope, context, params)`: if `context.tenantId && tenantId !== context.tenantId` → `AUDIT_QUERY_SCOPE_VIOLATION`.
   Code: `apps/control-plane/src/observability-audit-query.mjs:84-113`

3. `normalizeLimit(params.limit, pagination)` validates against `max_limit` (default 200).
   Code: `apps/control-plane/src/observability-audit-query.mjs:33-38`

4. `normalizeSort(scope, params.sort)` validates sort key against `allowed_sort_keys`.
   Code: line 40-48

5. `normalizeTimeWindow(params)` validates `occurredAfter <= occurredBefore`.
   Code: line 50-63

6. `loader(query)` executes the scoped query.

7. `buildMaskedAuditItems(result.items)` → applies `applyAuditExportMasking` to each record.
   Code: `apps/control-plane/src/observability-audit-query.mjs:168-170`

8. Returns `{ items, page: { nextCursor, hasMore }, queryScope, appliedFilters, availableFilters }`.

**Error flows:**

- E-1: `tenantId !== context.tenantId` → `AUDIT_QUERY_SCOPE_VIOLATION`.
  Code: `apps/control-plane/src/observability-audit-query.mjs:88-92`
- E-2: `limit > max_limit` → `AUDIT_QUERY_LIMIT_EXCEEDED`.
- E-3: Unknown sort key → `AUDIT_QUERY_INVALID_SORT`.
- E-4: `occurredAfter > occurredBefore` → `AUDIT_QUERY_INVALID_TIME_WINDOW`.

**Postconditions:** Masked audit records returned; cross-tenant isolation preserved by scope validation.

---

### uc-audit-02 — Correlate audit events by correlationId

**Title:** Tenant admin correlates audit events across subsystems using a correlationId

**Capabilities / Functionalities:** cap-audit / fn-audit-04

**Primary actor:** Tenant admin or platform auditor

**Tenant context:** Correlation query must stay within the caller's tenant scope (or platform scope for platform auditors).

**Preconditions:** Events with matching `correlationId` have been emitted by multiple subsystems. Masking profiles are compatible.

**Trigger:** `GET /v1/admin/audit/correlate/{correlationId}`

**Main success flow:**

1. `observability-audit-correlation.mjs` resolves the correlation surface via `listAuditCorrelationScopes`.
   Code: `apps/control-plane/src/observability-audit-correlation.mjs`

2. Timeline built with phases from `listAuditCorrelationTimelinePhases`.
   Code: `services/internal-contracts/src/index.mjs::listAuditCorrelationTimelinePhases`

3. Masking compatibility validated via `getAuditCorrelationMaskingCompatibility`.
   Code: `services/internal-contracts/src/index.mjs::getAuditCorrelationMaskingCompatibility`

4. Downstream trace sources surfaced.

**Error flows:**

- E-1: `correlationId` not found → empty timeline.
- E-2: Masking profile incompatibility between correlated events → validation error before delivery.

**Postconditions:** Timeline of correlated events returned across subsystems; all events within caller's tenant scope.

---

## Domain Q — Gateway

---

### uc-gw-01 — Idempotent mutation replay via gateway

**Title:** Client replays a POST mutation with the same Idempotency-Key

**Capabilities / Functionalities:** cap-gateway / fn-ctx-02

**Primary actor:** Any authenticated client

**Tenant context:** Idempotency key is tenant-unaware at the gateway level; scoped by body hash + key combination.

**Preconditions:** A prior mutation with the same `Idempotency-Key` header succeeded within the last 86400 s.

**Trigger:** Duplicate `POST /v1/workspaces` (or any mutation) with same `Idempotency-Key` header.

**Main success flow:**

1. Gateway reads `Idempotency-Key` header; looks up `sha256(requestBody)` in idempotency store (TTL 86400 s).
   Code: `services/gateway-config/base/public-api-routing.yaml:18-28`

2. Match found → cached response returned directly without forwarding to upstream.

3. `X-Idempotency-Replayed: true` added to response headers.
   Code: `services/gateway-config/base/public-api-routing.yaml:27` (`replayResponseHeader: X-Idempotency-Replayed`)

**Error flows:**

- E-1: `Idempotency-Key` missing on POST/PUT/PATCH/DELETE → 400 `Missing Idempotency-Key`.
  Code: `services/gateway-config/base/public-api-routing.yaml:20-23` (`requiredForMethods: [POST, PUT, PATCH, DELETE]`)
  Exception: `observability` and `native_admin` profiles exempt (`requireIdempotencyHeaderOnMutations: false`).
  Code: `services/gateway-config/base/public-api-routing.yaml:114-115`, `134`

**Postconditions:** Exactly-once semantics for mutations within TTL window; `X-Idempotency-Replayed: true` in response.

---

### uc-gw-02 — Capability-gated route blocked at APISIX

**Title:** Tenant without `realtime` capability attempts a WebSocket connection

**Capabilities / Functionalities:** cap-gateway, cap-realtime / fn-gateway-01, fn-quotas-03

**Primary actor:** Tenant on a plan without `realtime` capability

**Tenant context:** `X-Plan-Id` resolved from JWT claim; gate applied per-tenant at APISIX layer.

**Preconditions:** Tenant plan does not include `realtime` capability.

**Trigger:** `GET /v1/workspaces/{workspaceId}/realtime` (WebSocket upgrade).

**Main success flow (blocked):**

1. APISIX evaluates `capability_gates` from `capability-gated-routes.yaml`.
   Code: `services/gateway-config/routes/capability-gated-routes.yaml:21-26`

2. `realtime` capability not in tenant's plan → 403 before WebSocket upgrade.

3. `capabilityEnforcementDeniedEvent` audit event emitted (security category, extended retention).
   Code: `services/audit/src/contract-boundary.mjs`

**The five capability gates enforced at APISIX:**

| Capability | Routes blocked |
|---|---|
| `webhooks` | `/v1/workspaces/*/webhooks*` |
| `realtime` | `/v1/workspaces/*/realtime*`, `GET /v1/events/subscribe` |
| `sql_admin_api` | `/v1/workspaces/*/sql*`, `/v1/workspaces/*/admin/sql*` |
| `passthrough_admin` | `/v1/workspaces/*/admin/passthrough*` |
| `functions_public` | `POST /v1/functions/*/invoke`, `/v1/workspaces/*/functions/public*` |

Code: `services/gateway-config/routes/capability-gated-routes.yaml:15-44`

**Postconditions:** 403 returned; gateway is the first enforcement layer; backend services apply additional checks independently.

---

## Summary

| Use Case ID | Title | Cap / Fn IDs | Actor |
|---|---|---|---|
| uc-tenant-01 | Provision new tenant | cap-tenant-provisioning / fn-provisioning-01,02 | Platform operator |
| uc-tenant-02 | Suspend tenant | cap-tenant-lifecycle / fn-tenant-lifecycle-01 | Platform operator |
| uc-tenant-03 | Purge soft-deleted tenant | cap-tenant-lifecycle / fn-tenant-lifecycle-01,02 | Platform operator |
| uc-tenant-04 | Export tenant config | cap-tenant-lifecycle / fn-tenant-lifecycle-04 | Tenant admin |
| uc-workspace-01 | Create workspace | cap-workspace-lifecycle / fn-workspace-lifecycle-01,03 | Tenant admin |
| uc-workspace-02 | Clone workspace | cap-workspace-lifecycle / fn-workspace-lifecycle-01,02 | Tenant admin |
| uc-auth-01 | Console login | cap-auth-console / fn-auth-01 | Workspace member |
| uc-auth-02 | User signup | cap-auth-console / fn-auth-02 | Anonymous |
| uc-auth-03 | Approve pending user | cap-external-apps-service-accounts / fn-iam-01 | Workspace admin |
| uc-iam-01 | Manage Keycloak realm/client | cap-iam-admin / fn-iam-01,02,03 | Tenant admin |
| uc-iam-02 | Create/rotate service account | cap-external-apps-service-accounts / fn-extapp-01,02 | Workspace developer |
| uc-token-01 | JWT validation | cap-token-validation / fn-token-01,02 | Any actor |
| uc-ctx-01 | Reject spoofed headers | cap-context-propagation / fn-ctx-01 | Attacker (blocked) |
| uc-pg-01 | Provision Postgres DB | cap-postgres-data-api / fn-pg-01 | Workspace developer |
| uc-pg-02 | Admin SQL execution | cap-postgres-data-api / fn-pg-02 | Workspace developer |
| uc-pg-cdc-01 | Enable Postgres CDC | cap-pg-cdc / fn-pg-cdc-01,02,03 | Workspace developer |
| uc-mongo-01 | Enable MongoDB CDC | cap-mongo-cdc / fn-mongo-cdc-01 | Workspace developer |
| uc-storage-01 | Create storage bucket | cap-storage / fn-storage-01,02 | Tenant admin |
| uc-storage-02 | Issue/rotate storage creds | cap-storage / fn-storage-03 | Tenant admin |
| uc-storage-03 | Import objects | cap-storage / fn-storage-04 | Workspace developer |
| uc-realtime-01 | Open WebSocket session | cap-realtime / fn-realtime-01,05 | External app |
| uc-realtime-02 | Token expiry suspension | cap-realtime / fn-realtime-02 | System |
| uc-realtime-03 | Resume suspended session | cap-realtime / fn-realtime-03 | Authenticated client |
| uc-events-01 | Publish CloudEvent | cap-events / fn-events-01,02 | External app |
| uc-events-02 | Kafka trigger for function | cap-events, cap-functions / fn-events-02,fn-functions-05 | Workspace developer |
| uc-fn-01 | Deploy function | cap-functions / fn-functions-01,04 | Workspace developer |
| uc-fn-02 | Invoke function | cap-functions / fn-functions-02 | External app |
| uc-fn-03 | Create cron trigger | cap-functions, cap-scheduling / fn-functions-05,fn-scheduling-01,04,05 | Workspace developer |
| uc-fn-04 | Import function bundle | cap-functions / fn-functions-06 | Workspace developer |
| uc-wh-01 | Create webhook (SSRF guard) | cap-webhooks / fn-webhooks-01,02 | Workspace developer |
| uc-wh-02 | Pause/activate webhook | cap-webhooks / fn-webhooks-03 | Workspace developer |
| uc-sched-01 | Create cron job | cap-scheduling / fn-scheduling-01,04,05 | Workspace developer |
| uc-sched-02 | Auto-error on failures | cap-scheduling / fn-scheduling-02,03 | System |
| uc-backup-01 | Trigger on-demand backup | cap-backup-restore / fn-backup-01,03 | Tenant owner |
| uc-backup-02 | Cross-tenant backup denied | cap-backup-restore / fn-backup-02,03 | Attacker (blocked) |
| uc-secrets-01 | Vault audit log → Kafka | cap-secrets / fn-secrets-01 | System daemon |
| uc-quota-01 | Capability gate blocks family | cap-quotas-plans, cap-iam-admin / fn-quotas-03 | Tenant admin (blocked) |
| uc-quota-02 | Hard quota limit rejection | cap-quotas-plans, cap-scheduling / fn-quotas-04 | Workspace developer |
| uc-audit-01 | Query tenant audit events | cap-audit / fn-audit-01,02 | Tenant admin |
| uc-audit-02 | Correlate audit by correlationId | cap-audit / fn-audit-04 | Tenant admin |
| uc-gw-01 | Idempotent mutation replay | cap-gateway / fn-ctx-02 | Any client |
| uc-gw-02 | Capability gate at APISIX | cap-gateway, cap-realtime / fn-gateway-01 | Tenant (blocked) |
