# User Stories — Falcone BaaS (source-derived)

> Every story is anchored to real code (`path::symbol`). Tenant context is explicit.
> Roles: **platform operator** (superadmin), **tenant administrator**, **workspace developer** (member), **external-application integrator**, **end consumer** of a tenant app.
> Two-tenant fixture: tenant A (`ten_A`) and tenant B (`ten_B`); workspace A1 (`wrk_A1`) and workspace B1 (`wrk_B1`).
> Generated: 2026-06-08.

---

## Table of Contents

1. [cap-tenant-lifecycle / cap-tenant-provisioning — Tenant & Workspace Admin](#cap-tenant-lifecycle--cap-tenant-provisioning)
   - us-tenant-01, us-tenant-02, us-tenant-03, us-tenant-04, us-workspace-01, us-workspace-02
2. [cap-auth-console / cap-iam-admin — Authentication & IAM](#cap-auth-console--cap-iam-admin)
   - us-auth-01, us-auth-02, us-auth-03, us-iam-01, us-iam-02
3. [cap-token-validation / cap-context-propagation — Security Guards](#cap-token-validation--cap-context-propagation)
   - us-sec-01, us-sec-02
4. [cap-postgres-data-api / cap-pg-cdc — PostgreSQL](#cap-postgres-data-api--cap-pg-cdc)
   - us-pg-01, us-pg-02, us-pg-03
5. [cap-mongo-data-api / cap-mongo-cdc — MongoDB](#cap-mongo-data-api--cap-mongo-cdc)
   - us-mongo-01
6. [cap-storage — Object Storage](#cap-storage)
   - us-storage-01, us-storage-02, us-storage-03, us-storage-04
7. [cap-realtime — Realtime WebSocket](#cap-realtime)
   - us-realtime-01, us-realtime-02, us-realtime-03
8. [cap-events — Events / Kafka](#cap-events)
   - us-events-01, us-events-02
9. [cap-functions — Functions / Serverless](#cap-functions)
   - us-fn-01, us-fn-02, us-fn-03, us-fn-04
10. [cap-webhooks — Webhooks](#cap-webhooks)
    - us-wh-01, us-wh-02, us-wh-03
11. [cap-scheduling — Scheduling](#cap-scheduling)
    - us-sched-01, us-sched-02
12. [cap-backup-restore — Backup & Restore](#cap-backup-restore)
    - us-backup-01, us-backup-02
13. [cap-quotas-plans — Quotas, Plans & Capabilities](#cap-quotas-plans)
    - us-quota-01, us-quota-02, us-quota-03
14. [cap-audit — Audit & Observability](#cap-audit)
    - us-audit-01, us-audit-02, us-audit-03
15. [cap-gateway — Gateway Reliability](#cap-gateway)
    - us-gw-01, us-gw-02

---

## cap-tenant-lifecycle / cap-tenant-provisioning

---

### us-tenant-01

**As a** platform operator, **I want** to provision a new tenant through the admin console **so that** the tenant's Keycloak realm, Kafka topic namespace, Postgres schema, and APISIX routes are created atomically and I receive a trackable async job reference.

**Tenant context:** No tenant exists before the call. The operator acts at platform (superadmin) scope; `callerContext.tenantId` is the platform-level identity. The new tenant ID is allocated inside the workflow.

**Acceptance criteria:**

- GIVEN an authenticated superadmin with a unique `Idempotency-Key` (UUID v4) and valid `adminEmail`
  WHEN `POST /v1/admin/tenants` is submitted
  THEN the response is HTTP 202 with `{ status: 'pending', jobRef }` and `X-Correlation-Id` in headers.

- GIVEN the same `Idempotency-Key` submitted a second time (replay)
  WHEN the first job has already completed
  THEN the gateway returns the cached 202 response with `X-Idempotency-Replayed: true` and no second workflow is dispatched.

- GIVEN a non-superadmin user submitting the same endpoint
  WHEN the workflow guard runs
  THEN the response is 403 (`callerContext.actorType !== 'superadmin'` check).

- GIVEN the job completes successfully
  WHEN the async workflow finishes all four saga steps
  THEN a Keycloak realm, tenant DB record, Kafka topic namespace, and APISIX route configuration all exist; the job transitions to `succeeded`.

- Cross-tenant probe: a tenant-A admin attempting `POST /v1/admin/tenants` (platform-only route) receives 403 from the gateway tenant-binding guard.

**Linked:** uc-tenant-01 / fn-provisioning-01 / fn-provisioning-02 / cap-tenant-provisioning

**UI/API flow (Playwright script):**
1. Navigate to `/login`; submit superadmin credentials via the form (`apps/web-console/src/pages/LoginPage.tsx::LoginPage`).
2. After redirect to `/console/overview`, navigate to `/console/tenants` (`apps/web-console/src/pages/ConsoleTenantsPage.tsx`).
3. Click "New tenant"; fill in `adminEmail`, `tenantName`; the form submits `POST /v1/admin/tenants` with a generated `Idempotency-Key` header (`apps/control-plane/src/workflows/wf-con-002.mjs::handleTenantProvisioning`).
4. Assert the response panel shows `status: pending` and `jobRef` is non-null.
5. Navigate to `/console/operations`; poll for the operation to reach `succeeded` (`apps/web-console/src/pages/ConsoleOperationsPage.tsx`).
6. Sign in as tenant-A admin; repeat the same `POST /v1/admin/tenants` call; assert HTTP 403.

---

### us-tenant-02

**As a** platform operator, **I want** to suspend an active tenant **so that** all API access on behalf of that tenant is blocked and storage credentials are immediately revoked.

**Tenant context:** Target tenant `ten_B` is `active`. Operator's own `callerContext.tenantId` is the platform identity. After suspension, `ten_B` state = `suspended` and `normalizeCredentialHealth` returns `'revoked'` for all storage credentials.

**Acceptance criteria:**

- GIVEN tenant `ten_B` is `active` and the operator has `hasElevatedAccess = true`
  WHEN `PATCH /v1/admin/tenants/ten_B` with `{ action: 'suspend' }` is submitted
  THEN HTTP 200; tenant state transitions to `suspended`; storage context credential health = `revoked`.

- GIVEN a workspace under `ten_B` is in a state incompatible with suspension
  WHEN the lifecycle mutation is previewed
  THEN `evaluateTenantLifecycleMutation` returns `{ allowed: false, reason: 'workspace_in_incompatible_state' }` and HTTP 422 is returned.

- GIVEN `hasElevatedAccess = false`
  WHEN the purge or delete variant is attempted
  THEN the state machine blocks the transition and returns 422.

- Cross-tenant probe: a tenant-A admin cannot suspend tenant B (`tenantBinding: required` on the admin family blocks the request with 403).

**Linked:** uc-tenant-02 / fn-tenant-lifecycle-01 / cap-tenant-lifecycle

**UI/API flow (Playwright script):**
1. Sign in as superadmin.
2. Navigate to `/console/tenants`; locate `ten_B`; click "Suspend".
3. Confirm the action in the destructive confirmation dialog.
4. Assert the tenant row shows state `suspended` and `storage context: revoked`.
5. Sign in as `ten_A` admin; attempt `PATCH /v1/admin/tenants/ten_B`; assert 403.

---

### us-tenant-03

**As a** platform operator, **I want** to purge a soft-deleted tenant with dual confirmation **so that** all tenant infrastructure (Keycloak realm, Kafka namespace, storage, Postgres schema) is permanently cleaned up with no orphaned data.

**Tenant context:** Target tenant is in state `soft_deleted`. Operator provides `approvalTicket` + verbatim `confirmationText` + `hasElevatedAccess=true` + `hasSecondConfirmation=true`. The platform-level caller does not own the tenant being purged.

**Acceptance criteria:**

- GIVEN tenant is `soft_deleted`, `hasElevatedAccess=true`, `hasSecondConfirmation=true`, non-empty `approvalTicket`
  WHEN `DELETE /v1/admin/tenants/{tenantId}` is submitted
  THEN all provisioning appliers execute (reverse order: OpenWhisk, storage, MongoDB, Postgres, Kafka, Keycloak); audit event `tenant.purged` emitted; HTTP 200.

- GIVEN `hasSecondConfirmation=false`
  WHEN the purge mutation is evaluated
  THEN state machine returns `allowed: false` and 422 is returned.

- GIVEN `approvalTicket` is an empty string
  WHEN the purge draft is built
  THEN the draft is semantically incomplete; consumer-level validation rejects the request.

- Cross-tenant probe: no tenant's own admin can invoke the purge endpoint (platform-only route; `tenantBinding: required` blocks non-platform actors).

**Linked:** uc-tenant-03 / fn-tenant-lifecycle-01 / fn-tenant-lifecycle-02 / cap-tenant-lifecycle

**UI/API flow (Playwright script):**
1. Ensure `ten_B` is `soft_deleted` (via prior suspend + soft-delete sequence).
2. Sign in as superadmin.
3. Navigate to `/console/tenants`; locate `ten_B`; click "Purge".
4. Enter `approvalTicket`, verbatim `confirmationText`; enable "I understand" toggle (second confirmation).
5. Submit; assert HTTP 200; assert no Keycloak realm, Kafka topic namespace, or storage bucket for `ten_B` remains reachable.

---

### us-tenant-04

**As a** tenant administrator, **I want** to export a full functional configuration snapshot of my tenant **so that** I can inspect quotas, governance rules, workspace inventory, and service account references for audit or migration purposes — without ever seeing secret values.

**Tenant context:** Caller's `tenantId` must match the target tenant in the URL. Platform admins may export any tenant. Export `redactionMode` always defaults to `'secret_references_only'`.

**Acceptance criteria:**

- GIVEN an authenticated `tenant_admin` for `ten_A`
  WHEN `GET /v1/admin/tenants/ten_A/export` is submitted
  THEN response contains sections: `tenant`, `labels`, `quotas`, `governance`, workspace/application/service-account/managed-resource inventories, `redactionMode='secret_references_only'`, `recoveryArtifacts`.

- GIVEN `redactionMode` is not explicitly passed
  WHEN the export is built
  THEN `buildTenantFunctionalConfigurationExport` sets `redactionMode='secret_references_only'` — no secret values in the payload.

- Cross-tenant probe: `ten_A` admin attempting `GET /v1/admin/tenants/ten_B/export` receives 403 (`tenantBinding: required` enforced by gateway).

**Linked:** uc-tenant-04 / fn-tenant-lifecycle-04 / cap-tenant-lifecycle

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin.
2. Navigate to `/console/tenants`; select `ten_A`; click "Export configuration" (`apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx`).
3. Assert response JSON contains `redactionMode: 'secret_references_only'` and no raw secret values.
4. Attempt the same export URL for `ten_B`; assert 403.

---

### us-workspace-01

**As a** tenant administrator, **I want** to create a new workspace inside my tenant **so that** a dedicated Keycloak OIDC client, database record, and storage boundary are provisioned, all scoped to my tenant.

**Tenant context:** `callerContext.tenantId` must equal `requestTenantId`. Cross-tenant boundary is enforced explicitly in WF-CON-003: `callerContext.requestTenantId !== callerContext.tenantId → FORBIDDEN`.

**Acceptance criteria:**

- GIVEN an authenticated `tenant_admin` for `ten_A` with valid `idempotencyKey` and `correlationId`
  WHEN `POST /v1/workspaces` is submitted with `tenantId: ten_A`
  THEN HTTP 202; job transitions to `succeeded`; Keycloak client, workspace DB record, and storage boundary all exist with `tenant_id = ten_A`.

- GIVEN the tenant storage context is not active (`providerStatus != ready` or `capabilityAvailable = false`)
  WHEN workspace creation reaches the storage step
  THEN `previewWorkspaceStorageBootstrap` returns `requestedState: 'dependency_wait'` or `'blocked'`; job records the failure step.

- Cross-tenant probe: submitting `requestTenantId = ten_B` while authenticated as `ten_A` admin triggers `FORBIDDEN` at `apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs:135-137`.

**Linked:** uc-workspace-01 / fn-workspace-lifecycle-01 / fn-workspace-lifecycle-03 / cap-workspace-lifecycle

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin.
2. Navigate to `/console/workspaces` (`apps/web-console/src/pages/ConsoleWorkspacesPage.tsx`); click "New workspace".
3. Fill in workspace name; submit.
4. Poll `/console/operations` until job is `succeeded`.
5. Assert workspace appears in the list with `tenantId = ten_A`.
6. Try to create a workspace using `ten_B`'s `tenantId` in the body; assert 403.

---

### us-workspace-02

**As a** tenant administrator, **I want** to clone an existing workspace into a new one **so that** I get the same application configuration without any credentials leaking into the clone, and shared tenant-level resources are reused rather than duplicated.

**Tenant context:** Both source and target workspaces must belong to the same tenant. `resetCredentialReferences: true` is enforced by `buildWorkspaceCloneDraft` by default.

**Acceptance criteria:**

- GIVEN source workspace `wrk_A1` exists in `ten_A` and is in a clonable state
  WHEN `POST /v1/workspaces/wrk_A1/clone` is submitted by a `ten_A` admin
  THEN a new workspace is created; `resourceInheritance.mode = 'clone_workspace'`; no credentials from `wrk_A1` appear in the clone (`resetCredentialReferences: true`); shared Kafka topic namespaces reference the same tenant-level resource.

- GIVEN `sourceWorkspace.workspaceId` is missing in the clone request
  WHEN `buildWorkspaceCloneDraft` is called
  THEN an error is thrown immediately (guard in `services/internal-contracts/src/index.mjs:1267`).

- Cross-tenant probe: a `ten_A` admin submitting the clone endpoint for a workspace belonging to `ten_B` receives 403.

**Linked:** uc-workspace-02 / fn-workspace-lifecycle-01 / fn-workspace-lifecycle-02 / cap-workspace-lifecycle

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin.
2. Navigate to `/console/workspaces`; locate `wrk_A1`; click "Clone".
3. Fill in new workspace name; submit.
4. Assert clone created with `tenantId = ten_A` and no credential values copied.
5. Attempt to clone a workspace from `ten_B`; assert 403.

---

## cap-auth-console / cap-iam-admin

---

### us-auth-01

**As a** workspace member, **I want** to log in to the web console using my username and password **so that** I receive a session token scoped to my tenant and am redirected to the originally requested page.

**Tenant context:** The `auth` family has `tenantBinding: none` — authentication is pre-tenant. After login, the JWT's `tenant_id` claim identifies the user's tenant for all subsequent requests.

**Acceptance criteria:**

- GIVEN valid credentials for a user in `ten_A`'s Keycloak realm
  WHEN the login form at `/login` is submitted
  THEN `createConsoleLoginSession` calls `POST /v1/auth/login`; a JWT is returned; `persistConsoleShellSession` stores the session; the user is redirected to `/console/overview` (or the original protected destination).

- GIVEN the account has `account_suspended` status
  WHEN the login returns HTTP 409 with the suspended status code
  THEN `inferStatusViewFromError` surfaces the `account_suspended` view with allowed actions; no token is issued.

- GIVEN an expired token on a subsequent navigation to a protected route
  WHEN `ProtectedRoute` checks the session
  THEN the user is redirected to `/login` with the original path stored as `protectedRouteIntent`.

- GIVEN invalid credentials
  WHEN the form is submitted
  THEN HTTP 400/403 triggers the destructive feedback variant: "No hemos podido validar tus credenciales".

**Linked:** uc-auth-01 / fn-auth-01 / cap-auth-console

**UI/API flow (Playwright script):**
1. Navigate to `/login` (`apps/web-console/src/pages/LoginPage.tsx`).
2. Enter valid `username` + `password` for `ten_A`; click submit.
3. Assert redirect to `/console/overview`; session stored.
4. Log out; enter wrong password; assert destructive feedback.
5. As suspended user: assert 409 response surfaces `account_suspended` status view.

---

### us-auth-02

**As an** anonymous user, **I want** to sign up for a workspace **so that** my account is created in pending-activation state and I know to wait for admin approval.

**Tenant context:** The `auth` family has `tenantBinding: none`; signup may be tenant-specific (invite link) or global. `GET /v1/auth/signups/policy` is queried before showing the signup option.

**Acceptance criteria:**

- GIVEN the signup policy returns `allowed: true`
  WHEN the login page loads
  THEN the "Sign up" button is visible and links to `/signup`.

- GIVEN the signup form is completed and submitted to `POST /v1/auth/signup`
  WHEN the server creates the account
  THEN the user is redirected to `/signup/pending-activation` (`apps/web-console/src/pages/PendingActivationPage.tsx`) and no token is issued.

- GIVEN the signup policy returns `allowed: false`
  WHEN the login page loads
  THEN the "Sign up" option is replaced with an alert showing the reason; signup is not available.

- Cross-tenant probe: users registered under `ten_A`'s Keycloak realm cannot receive tokens scoped to `ten_B`.

**Linked:** uc-auth-02 / fn-auth-02 / cap-auth-console

**UI/API flow (Playwright script):**
1. Navigate to `/login`; observe signup policy fetch from `GET /v1/auth/signups/policy`.
2. If `allowed: true` — click "Sign up" (`apps/web-console/src/pages/SignupPage.tsx`); fill in registration form; submit.
3. Assert redirect to `/signup/pending-activation`.
4. Verify no session cookie or JWT is set.
5. Test denied path: mock policy to return `allowed: false`; reload login; assert signup button absent.

---

### us-auth-03

**As a** workspace admin, **I want** to approve a pending user via the workflow console **so that** the user receives the requested role and can access the workspace.

**Tenant context:** `callerContext.tenantId` must match the workspace tenant. `getScopeValidation` in WF-CON-001 enforces `requestTenantId === callerContext.tenantId` and `requestWorkspaceId === callerContext.workspaceId`.

**Acceptance criteria:**

- GIVEN a user in `pending_activation` state in workspace `wrk_A1` of tenant `ten_A`
  WHEN `wrk_A1` admin invokes WF-CON-001 with `{ userId, requestedRole, targetWorkspaceId: wrk_A1 }`
  THEN `keycloakAdmin.assignRole` is called in the `ten_A` realm; membership record is `active`; job transitions to `succeeded`.

- GIVEN `requestTenantId !== callerContext.tenantId`
  WHEN the scope validation runs
  THEN `FORBIDDEN` is returned; no role is assigned.

- GIVEN the same `idempotencyKey` is submitted twice while the first is in-flight
  WHEN idempotency is checked
  THEN `DUPLICATE_INVOCATION` is returned; second invocation is blocked.

**Linked:** uc-auth-03 / fn-iam-01 / cap-auth-console

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` admin.
2. Navigate to `/console/members` (`apps/web-console/src/pages/ConsoleMembersPage.tsx`).
3. Locate pending user; click "Approve"; select role; submit.
4. Assert user record shows `active` membership.
5. Attempt to approve a user from `ten_B`'s workspace while authenticated as `ten_A` admin; assert 403.

---

### us-iam-01

**As a** tenant administrator with the `identity.sso.oidc` plan capability, **I want** to create an OIDC client in my Keycloak realm **so that** external applications can authenticate using my tenant's SSO, with reserved realm names and non-HTTPS redirect URIs rejected.

**Tenant context:** All Keycloak operations scoped to `ten_A`'s realm via `X-Tenant-Id`. Reserved realm IDs `master` and `in-falcone-platform` are blocked. Non-HTTPS redirect URIs are rejected in production mode.

**Acceptance criteria:**

- GIVEN `ten_A` plan includes `identity.sso.oidc`
  WHEN `POST /v1/admin/iam/clients` with valid `realmId`, `clientId`, `protocol: 'openid-connect'`, HTTPS redirect URIs
  THEN Keycloak client is created; HTTP 201; audit event with `resource.type = 'iam_client'`.

- GIVEN `realmId = 'master'` (reserved)
  WHEN the request is processed
  THEN `RESERVED_REALM_IDS` check rejects with 422.

- GIVEN `protocol = 'grpc'` (unsupported)
  WHEN the request is processed
  THEN `SUPPORTED_CLIENT_PROTOCOLS` check rejects with 422.

- GIVEN a redirect URI with `http://` scheme (non-HTTPS, non-localhost)
  WHEN `isLikelyHttpsUri` evaluates the URI
  THEN the violation is returned with `error` severity; request rejected.

- GIVEN `ten_A` plan does NOT include `identity.sso.oidc`
  WHEN the IAM family route is accessed
  THEN gateway returns 403 `capability_denied` before reaching control-plane (`services/gateway-config/base/public-api-routing.yaml:273-274`).

- Cross-tenant probe: `ten_A` admin cannot create a client in `ten_B`'s realm; `X-Tenant-Id` is derived from the JWT, not from a spoofed header.

**Linked:** uc-iam-01 / fn-iam-01 / fn-iam-02 / fn-iam-03 / cap-iam-admin

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin (plan includes `identity.sso.oidc`).
2. Navigate to `/console/auth` (`apps/web-console/src/pages/ConsoleAuthPage.tsx`).
3. Open the "New OIDC client" form; fill in `clientId`, redirect URIs (`https://app.example.com/callback`); submit.
4. Assert client created in Keycloak tenant realm.
5. Retry with `realmId = 'master'`; assert 422.
6. Retry as `ten_B` admin whose plan lacks `identity.sso.oidc`; assert 403 capability_denied.

---

### us-iam-02

**As a** workspace developer, **I want** to create a service account and then rotate its credential with a grace period **so that** I can migrate integrations to the new key before the old one expires, without exceeding the maximum active credential count.

**Tenant context:** `requestTenantId` must equal `callerContext.tenantId` (enforced via `getScopeValidation`). Credentials scoped to `(tenantId, workspaceId)`. Rotation event published to `console.credential-rotation.initiated` Kafka topic.

**Acceptance criteria:**

- GIVEN workspace `wrk_A1` is active and the developer's plan allows service accounts
  WHEN WF-CON-006 is invoked with `serviceAccountAction: 'create'`
  THEN Keycloak service account created in `ten_A` realm; DB record carries `tenantId=ten_A`, `workspaceId=wrk_A1`.

- GIVEN an existing service account with one active credential
  WHEN WF-CON-004 is invoked with `credentialAction: 'rotate'`, `gracePeriodSeconds > 0`
  THEN `rotateCredential` in dual-key mode; both old and new key registered in APISIX; `createRotationStateRecord` persists `gracePeriodSeconds`, `oldCredentialId`, `newCredentialId`; rotation event published.

- GIVEN active credential count equals `maxActiveCredentials` (default 3)
  WHEN rotation is attempted
  THEN `CREDENTIAL_LIMIT_EXCEEDED` is returned; no new credential is created.

- GIVEN a rotation is already in progress
  WHEN a second rotation is attempted
  THEN `ROTATION_IN_PROGRESS` is returned.

- Cross-tenant probe: `requestTenantId = ten_B` while authenticated as `ten_A` developer triggers `FORBIDDEN` (`apps/control-plane/src/workflows/wf-con-006-service-account.mjs:43-48`).

**Linked:** uc-iam-02 / fn-extapp-01 / fn-extapp-02 / cap-external-apps-service-accounts

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer.
2. Navigate to `/console/service-accounts` (`apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx`).
3. Enter display name; click "Crear" — asserts `createServiceAccount` call and feedback with new `serviceAccountId`.
4. Click "Emitir" on the created account — asserts credential issued; "Secreto visible una sola vez" dialog shown.
5. Click "Rotar" — asserts `rotateServiceAccountCredential` call; new credential dialog shown; rotation event on Kafka.
6. Exhaust credential limit (create 3 active credentials); attempt rotation; assert `CREDENTIAL_LIMIT_EXCEEDED`.
7. Attempt service account creation with `requestTenantId = ten_B`; assert 403.

---

## cap-token-validation / cap-context-propagation

---

### us-sec-01

**As any** authenticated actor, **I want** the gateway to validate my Bearer JWT against the tenant's Keycloak JWKS and propagate my tenant context to all upstream services **so that** I never need to pass tenant headers manually and cross-tenant access is impossible.

**Tenant context:** `tenant_id` claim is extracted from the JWT by `normalizeClaims` and injected as `X-Tenant-Id` by the gateway. No upstream service relies on client-supplied `X-Tenant-Id` headers.

**Acceptance criteria:**

- GIVEN a valid JWT with `kid` matching a JWKS key
  WHEN any authenticated request is made
  THEN `verifyLocally` succeeds; `X-Tenant-Id`, `X-Auth-Scopes`, `X-Actor-Roles` are set from JWT claims; `X-Idempotency-Replayed` is absent.

- GIVEN a JWT with an unknown `kid` (after key rotation)
  WHEN the first local verification fails
  THEN `isUnknownKidError` triggers JWKS refresh (`forceRefresh=true`); if still unknown, `introspectToken` is called; `active: false` → `TOKEN_REVOKED`.

- GIVEN a JWT with missing `kid` header
  WHEN `decodeProtectedHeader` is called
  THEN `TOKEN_INVALID` is returned before any upstream receives the request.

- GIVEN a JWT that has passed its `exp` timestamp (beyond 5 s grace)
  WHEN `jwtVerify` evaluates the token
  THEN `ERR_JWT_EXPIRED` is thrown and mapped to `TOKEN_EXPIRED` (HTTP 401).

**Linked:** uc-token-01 / fn-token-01 / fn-token-02 / cap-token-validation

**UI/API flow (Playwright script):**
1. Obtain a valid JWT for `ten_A`; make an authenticated request; assert `X-Tenant-Id = ten_A` reflected in response.
2. Use an expired JWT; assert 401 with `TOKEN_EXPIRED` error code.
3. Use a JWT with `kid` not in JWKS; mock Keycloak introspection to return `active: false`; assert `TOKEN_REVOKED`.

---

### us-sec-02

**As a** security auditor, **I want** the gateway to reject any attempt to inject `X-Tenant-Id`, `X-Workspace-Id`, or `X-Plan-Id` headers from an external client **so that** an attacker holding a valid JWT for `ten_A` cannot access `ten_B`'s data by spoofing context headers.

**Tenant context:** `rejectSpoofedContextHeaders: true` is set on every request validation profile. The gateway strips and re-derives these headers from the validated JWT only.

**Acceptance criteria:**

- GIVEN a valid JWT for `ten_A`
  WHEN the request includes a custom header `X-Tenant-Id: ten_B`
  THEN the gateway ignores the injected header; all upstreams receive `X-Tenant-Id: ten_A` derived from the JWT (`services/gateway-config/base/public-api-routing.yaml:87-99`).

- GIVEN a request carrying `X-Plan-Id: enterprise-unlimited` in the inbound headers
  WHEN the gateway processes the request
  THEN `X-Plan-Id` is re-derived from the JWT plan claim; the injected value has no effect on capability gates.

**Linked:** uc-ctx-01 / fn-ctx-01 / cap-context-propagation

**UI/API flow (Playwright script):**
1. Obtain `ten_A` JWT; make `GET /v1/storage/buckets` with custom header `X-Tenant-Id: ten_B`.
2. Assert response returns only `ten_A` buckets (not `ten_B`'s).
3. Repeat with `X-Plan-Id: enterprise-unlimited`; assert capability gates still apply as per the JWT's plan claim.

---

## cap-postgres-data-api / cap-pg-cdc

---

### us-pg-01

**As a** workspace developer with `data.postgresql.shared` in my plan, **I want** to provision a managed PostgreSQL database for my workspace **so that** I get an isolated schema with the correct admin profile and extension set.

**Tenant context:** `tenantBinding: required`, `workspaceBinding: required` for the `postgres` family. `getPostgresCompatibilitySummary` resolves the admin profile per workspace. The schema is allocated in the tenant's namespace.

**Acceptance criteria:**

- GIVEN plan includes `data.postgresql.shared` and workspace is `active`
  WHEN `POST /v1/postgres/databases` is submitted
  THEN `resolvePostgresAdminProfile` determines shared placement; schema provisioned with `tenant_id` scope; audit event with `resource.type = 'postgres_database'`.

- GIVEN plan does NOT include `data.postgresql.*`
  WHEN the request reaches the gateway
  THEN 403 `capability_denied` before any control-plane processing.

- Cross-tenant probe: `ten_A` developer cannot access `ten_B`'s Postgres databases; `workspaceBinding: required` + RLS (`SET app.tenant_id`) enforce scope.

**Linked:** uc-pg-01 / fn-pg-01 / cap-postgres-data-api

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer.
2. Navigate to `/console/postgres` (`apps/web-console/src/pages/ConsolePostgresPage.tsx`).
3. Click "Provision database"; confirm; assert database appears with correct schema and admin profile.
4. Sign in as `ten_B` developer without postgres capability; navigate to `/console/postgres`; assert the UI shows capability-gated empty state.

---

### us-pg-02

**As a** workspace developer with the `sql_admin_api` capability, **I want** to execute admin SQL directly on my workspace's Postgres schema **so that** I can run migrations and inspect data, while the system automatically sets `app.tenant_id` and `app.workspace_id` for RLS enforcement.

**Tenant context:** `X-Tenant-Id` and `X-Workspace-Id` propagated; `SET app.tenant_id` and `SET app.workspace_id` set before every SQL execution. Only roles in `POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES` may execute.

**Acceptance criteria:**

- GIVEN `sql_admin_api` capability in plan and actor role is in the allowed list
  WHEN `POST /v1/workspaces/wrk_A1/sql` is submitted with a valid SQL statement
  THEN query executes scoped to the workspace schema; result returned; audit event `sql_admin.executed`.

- GIVEN `sql_admin_api` capability is absent
  WHEN the gateway evaluates the route
  THEN 403 capability_denied returned before control-plane processes the request (`services/gateway-config/routes/capability-gated-routes.yaml:27-35`).

- Cross-tenant probe: `ten_A` developer cannot execute SQL against `wrk_B1`'s schema; workspace binding enforces scoping.

**Linked:** uc-pg-02 / fn-pg-02 / cap-postgres-data-api

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer with `sql_admin_api` capability.
2. Navigate to `/console/postgres`; open the SQL editor panel.
3. Submit a `SELECT 1` query; assert result returned.
4. Sign in as `ten_B` developer without `sql_admin_api`; attempt the same endpoint; assert 403.

---

### us-pg-03

**As a** workspace developer, **I want** to enable change-data-capture on my Postgres tables and have changes streamed to a workspace-scoped Kafka topic **so that** I can build event-driven features on top of database mutations.

**Tenant context:** WAL listener keyed to `(data_source_ref, tenant_id)`. Kafka topic name always embeds `{tenantId}.{workspaceId}.pg-changes`. CloudEvents headers carry `ce-tenantid` and `ce-workspaceid`. Rate-limited at 1000 events/s per workspace.

**Acceptance criteria:**

- GIVEN a Postgres data source exists for `wrk_A1`
  WHEN `POST /v1/workspaces/wrk_A1/pg-captures` is submitted
  THEN a `pg_capture_configs` row is inserted with `status='active'`, `tenant_id=ten_A`, `workspace_id=wrk_A1`; WAL listener starts; events flow to `{tenantId}.{workspaceId}.pg-changes`.

- GIVEN WAL events are produced at > 1000/s
  WHEN `KafkaChangePublisher._allow(workspaceId)` evaluates the rate
  THEN events exceeding the limit are dropped; `pg_cdc_events_rate_limited_total` metric incremented (`services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:34`).

- GIVEN the WAL listener loses its database connection
  WHEN reconnect fails
  THEN exponential backoff applies (initial 1 s, max 60 s); listener eventually resumes.

- Cross-tenant probe: a CDC event produced by `ten_A.wrk_A1` is published to `ten_A.wrk_A1.pg-changes` and never reaches `ten_B.wrk_B1` consumers.

**Linked:** uc-pg-cdc-01 / fn-pg-cdc-01 / fn-pg-cdc-02 / fn-pg-cdc-03 / fn-isolation-02 / cap-pg-cdc

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer.
2. Navigate to `/console/postgres`; click "Enable CDC" for a data source.
3. Assert capture config created with `tenant_id = ten_A`.
4. Verify Kafka topic name pattern matches `ten_A.wrk_A1.pg-changes`.
5. Insert a row; assert CloudEvent message on the topic with `ce-tenantid = ten_A`.

---

## cap-mongo-data-api / cap-mongo-cdc

---

### us-mongo-01

**As a** workspace developer, **I want** to enable MongoDB change-stream CDC with resume-token durability **so that** if the service restarts I can resume from the last known position and changes are not silently dropped.

**Tenant context:** `mongo_capture_configs` row carries `tenant_id`, `workspace_id`. Audit log (`mongo_capture_audit_log`) always records `tenant_id`, `workspace_id`, `actor_identity` for every lifecycle event.

**Acceptance criteria:**

- GIVEN a MongoDB instance accessible from the workspace
  WHEN `POST /v1/realtime/workspaces/wrk_A1/mongo-captures` is submitted
  THEN `mongo_capture_configs` row inserted with `tenant_id=ten_A`, `status='active'`; `ChangeStreamManager` starts; resume token stored in `ResumeTokenStore`.

- GIVEN the service restarts with a valid resume token stored
  WHEN `ChangeStreamManager` initialises
  THEN change stream resumes from the last token; no events are missed.

- GIVEN a change stream error occurs
  WHEN `statusUpdater` handles the error
  THEN `mongo_capture_configs.status` and `last_error` are updated; audit log entry inserted with `actor_identity`.

- Cross-tenant probe: audit log entries for `ten_A.wrk_A1` captures are not accessible to `ten_B` queries.

**Linked:** uc-mongo-01 / fn-mongo-cdc-01 / fn-mongo-01 / fn-isolation-05 / cap-mongo-cdc

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer.
2. Navigate to `/console/mongo` (`apps/web-console/src/pages/ConsoleMongoPage.tsx`); click "Enable CDC".
3. Assert capture config row exists with `tenant_id = ten_A`.
4. Simulate service restart; assert capture resumes from stored token.
5. Assert audit log entries carry `tenant_id = ten_A` and `workspace_id = wrk_A1`.

---

## cap-storage

---

### us-storage-01

**As a** tenant administrator, **I want** to create an object storage bucket within my tenant's namespace **so that** my workspaces have isolated object storage that is blocked from being provisioned if my tenant is suspended or over the bucket quota.

**Tenant context:** Bucket namespace is derived deterministically as `tctx-{slug}-{sha256(...)}` via `deriveTenantStorageNamespace`. `namespaceBindingMode = tenant_isolated` — cross-tenant bucket access is impossible via the API.

**Acceptance criteria:**

- GIVEN tenant storage context is `active`, `capabilityAvailable=true`, `providerStatus=ready`, bucket count < 8 (default)
  WHEN `POST /v1/storage/buckets` is submitted by `ten_A` admin
  THEN bucket created in namespace `tctx-{ten_A_slug}-{hash}`; quota snapshot updated; audit event `tenant_storage_context.provisioned`.

- GIVEN tenant state is `suspended`
  WHEN bucket creation is attempted
  THEN `buildTenantStorageContextRecord` sets `bucketProvisioningAllowed=false`; 422 returned (`services/adapters/src/storage-tenant-context.mjs:229`).

- GIVEN bucket count equals `tenant.storage.buckets.max` (8)
  WHEN another bucket creation is attempted
  THEN `buildTenantStorageQuotaAssignment` returns `OPERATION_LIMIT_EXCEEDED`; 422 returned.

- GIVEN `tenantId` is missing in `deriveTenantStorageNamespace`
  WHEN the namespace is derived
  THEN immediate `Error` thrown (guard at `services/adapters/src/storage-tenant-context.mjs:117`).

- Cross-tenant probe: `ten_A` admin cannot list or access buckets belonging to `ten_B`; namespace derivation is tenant-specific and non-guessable.

**Linked:** uc-storage-01 / fn-storage-01 / fn-storage-02 / fn-storage-ctx-01 / fn-storage-ctx-02 / cap-storage

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin.
2. Navigate to `/console/storage` (`apps/web-console/src/pages/ConsoleStoragePage.tsx`).
3. Click "Create bucket"; fill in name; submit.
4. Assert bucket appears in the list with `tenantId = ten_A` and `provisioning.state = active`.
5. Exhaust bucket quota; attempt another creation; assert `OPERATION_LIMIT_EXCEEDED`.
6. Sign in as `ten_B` admin; navigate to storage; assert `ten_A` buckets are not listed.

---

### us-storage-02

**As a** tenant administrator, **I want** to issue S3-compatible programmatic credentials for a bucket and later rotate them **so that** the old key is revoked and a new key is issued atomically, with credential values visible only at issuance time.

**Tenant context:** Credentials scoped to the tenant storage namespace. Revoked credentials are permanently inactive. `rotateTenantStorageContextCredential` emits `tenant_storage_context.{transition}` audit event with `actorUserId`.

**Acceptance criteria:**

- GIVEN tenant storage context is `active`
  WHEN `POST /v1/storage/credentials` is submitted
  THEN `buildStorageProgrammaticCredentialSecretEnvelope` creates credential at version 1; secret value returned once; subsequent GET never returns the value.

- GIVEN an existing active credential
  WHEN `POST /v1/storage/credentials/{credentialId}/rotate` is submitted
  THEN `rotateStorageProgrammaticCredential` increments version; new `secretRef` generated; audit event emitted with `actorUserId`.

- GIVEN tenant is suspended
  WHEN credential issuance is attempted
  THEN `normalizeCredentialHealth` returns `'revoked'`; new credentials cannot be issued (`services/adapters/src/storage-tenant-context.mjs:65-78`).

- Cross-tenant probe: `ten_A` admin cannot rotate credentials belonging to `ten_B`; tenant binding enforced.

**Linked:** uc-storage-02 / fn-storage-03 / cap-storage

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin; navigate to `/console/storage`.
2. Select a bucket; click "Issue credentials".
3. Assert secret value shown once in the response panel; close panel; assert value not retrievable again.
4. Click "Rotate"; assert new credential at incremented version; old credential shows `revoked` status.
5. Sign in as `ten_B` admin; attempt to rotate `ten_A`'s credential ID; assert 403.

---

### us-storage-03

**As a** workspace developer, **I want** to import objects into a bucket using a manifest **so that** I can batch-load files with a configurable conflict policy, and the system enforces a per-operation object count limit.

**Tenant context:** Import is scoped to the calling tenant's bucket namespace via `previewStorageImportResult`.

**Acceptance criteria:**

- GIVEN a valid manifest with `objectCount` below the `appliedLimit`
  WHEN `POST /v1/storage/buckets/{bucketId}/import` is submitted
  THEN objects are written; outcome is `imported` if all succeed, `partial_failure` if some fail, `export_empty_result` if count is 0.

- GIVEN `objectCount > appliedLimit`
  WHEN `checkImportExportOperationLimit` evaluates
  THEN `OPERATION_LIMIT_EXCEEDED` is returned before any objects are written (422).

- Cross-tenant probe: `ten_A` developer cannot import into `ten_B`'s bucket; tenant binding prevents access to the bucket resource.

**Linked:** uc-storage-03 / fn-storage-04 / cap-storage

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/storage`.
2. Select a bucket; click "Import"; upload a manifest with 5 objects below the limit.
3. Assert `imported` outcome; objects appear in the bucket list.
4. Repeat with a manifest exceeding the limit; assert `OPERATION_LIMIT_EXCEEDED`.

---

### us-storage-04

**As a** workspace developer, **I want** to view real-time storage usage for my workspace (bytes, object count, bucket count) in the console **so that** I can proactively manage quota before hitting the limit.

**Tenant context:** `GET /v1/storage/workspaces/{workspaceId}/usage` is workspace-scoped; results filtered to `workspaceId` in the console (`ConsoleStoragePage.tsx:244`). Cross-workspace usage is not accessible.

**Acceptance criteria:**

- GIVEN a workspace with buckets containing objects
  WHEN the storage page loads for `wrk_A1`
  THEN `GET /v1/storage/workspaces/wrk_A1/usage` returns a snapshot with `dimensions.totalBytes`, `objectCount`, `bucketCount`, and per-bucket breakdown.

- GIVEN snapshot age > 15 minutes
  WHEN the page renders the usage section
  THEN an alert warns the user the data may be stale (`ConsoleStoragePage.tsx:475`).

- GIVEN quota `utilizationPercent >= 90`
  WHEN the progress bar renders
  THEN the bar uses the `bg-destructive` CSS class; a visual warning is shown.

- Cross-tenant probe: `GET /v1/storage/workspaces/wrk_B1/usage` requested by `ten_A` developer returns 403.

**Linked:** fn-storage-05 / cap-storage

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/storage`.
2. Assert usage snapshot panel shows byte usage, object count, and bucket count.
3. Mock snapshot `snapshotAt` to be > 15 min ago; assert stale data alert renders.
4. Sign in as `ten_A` developer; attempt `GET /v1/storage/workspaces/wrk_B1/usage`; assert 403.

---

## cap-realtime

---

### us-realtime-01

**As an** external-application integrator, **I want** to open a WebSocket connection to the realtime gateway and subscribe to workspace events **so that** my application receives changes in real-time without polling, and events from other tenants are never delivered to my session.

**Tenant context:** `realtime_sessions` row carries `tenant_id`, `workspace_id`. `guardEvent` enforces strict `session.tenantId === event.tenantId && session.workspaceId === event.workspaceId` for every event published to the session.

**Acceptance criteria:**

- GIVEN a valid JWT with `tenant_id=ten_A` and `wrk_A1` in `authorizedWorkspaces`, plan includes `realtime`
  WHEN a WebSocket upgrade to `wss://{host}/v1/websockets` is initiated with `Authorization: Bearer <jwt>`
  THEN session created in `realtime_sessions`; `status = 'ACTIVE'`; `startPolling` interval starts.

- GIVEN `tenant_id` is absent in JWT claims
  WHEN `checkScopes` evaluates
  THEN `{ allowed: false, missingScope: 'tenant_id' }` returned; connection rejected with `INSUFFICIENT_SCOPE`.

- GIVEN an event from `ten_B.wrk_B1` is pushed to the session
  WHEN `guardEvent` evaluates
  THEN `false` returned; event is not delivered to the `ten_A.wrk_A1` session.

- GIVEN plan does NOT include `realtime` capability
  WHEN the WebSocket upgrade request reaches the gateway
  THEN 403 capability_denied returned before the upgrade completes (`services/gateway-config/routes/capability-gated-routes.yaml:21-26`).

**Linked:** uc-realtime-01 / fn-realtime-01 / fn-realtime-05 / fn-isolation-01 / cap-realtime

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/workspaces/wrk_A1/realtime` (`apps/web-console/src/pages/ConsoleRealtimePage.tsx`).
2. Assert `GET /v1/workspaces/wrk_A1/realtime` succeeds; `realtimeEndpointUrl` displayed.
3. Open WebSocket to the realtime endpoint; assert session `ACTIVE` in DB.
4. Push a synthetic `ten_B.wrk_B1` event; assert it is not delivered to the `ten_A` session.
5. Repeat with a JWT missing `tenant_id`; assert connection refused with `INSUFFICIENT_SCOPE`.

---

### us-realtime-02

**As an** external-application integrator, **I want** the realtime gateway to automatically suspend my session when my token expires or is revoked **so that** stale sessions cannot receive events indefinitely.

**Tenant context:** `suspendSession` publishes `SUSPENDED` audit event to Kafka topic `console.realtime.subscription-lifecycle` with `tenantId` and `workspaceId`.

**Acceptance criteria:**

- GIVEN an active session for `wrk_A1` with a token that has since expired (past 5 s grace)
  WHEN the polling interval fires
  THEN `consecutive_failure_count` check triggers; `suspendSession` called with reason `TOKEN_EXPIRED`; `realtime_sessions` updated to `status = 'SUSPENDED'`; `SUSPENDED` event published to Kafka.

- GIVEN token is still within expiry but Keycloak introspection returns `active: false`
  WHEN polling calls `introspectTokenFn`
  THEN `suspendSession` called with reason `SCOPE_REVOKED`.

- GIVEN session is in `CLOSED` state
  WHEN the polling timer fires
  THEN timer is cleared without publishing a duplicate event.

**Linked:** uc-realtime-02 / fn-realtime-02 / cap-realtime

**UI/API flow (Playwright script):**
1. Open an active WebSocket session for `wrk_A1`.
2. Fast-forward time or use a short-lived JWT; wait for the polling interval.
3. Assert `realtime_sessions` row shows `status = 'SUSPENDED'`.
4. Assert `SUSPENDED` event present on `console.realtime.subscription-lifecycle` Kafka topic with `tenantId = ten_A`.

---

### us-realtime-03

**As an** external-application integrator, **I want** to resume a suspended WebSocket session by presenting a fresh token **so that** I don't need to create a new session and lose my subscription state.

**Tenant context:** New token must carry the same `tenant_id` as the existing session. `RESUMED` event published to Kafka only if prior status was `SUSPENDED`.

**Acceptance criteria:**

- GIVEN a `SUSPENDED` session for `wrk_A1`
  WHEN `refreshToken(sessionId, newBearerToken, db)` is called with a valid new JWT
  THEN `validateToken` succeeds; session updated to `ACTIVE`; polling restarted; `RESUMED` event published.

- GIVEN an unknown `sessionId`
  WHEN `refreshToken` is called
  THEN `Error('Unknown session ...')` is thrown.

- GIVEN the new token is already expired
  WHEN `validateToken` is called
  THEN `TOKEN_EXPIRED` is thrown; session remains `SUSPENDED`.

**Linked:** uc-realtime-03 / fn-realtime-03 / cap-realtime

**UI/API flow (Playwright script):**
1. Suspend a session (via expired token).
2. Obtain a new valid JWT for `wrk_A1`.
3. Send the token refresh message on the existing WebSocket connection.
4. Assert `realtime_sessions.status = 'ACTIVE'`; `RESUMED` event on Kafka.
5. Attempt resume with an expired token; assert `TOKEN_EXPIRED`; session stays `SUSPENDED`.

---

## cap-events

---

### us-events-01

**As an** external-application integrator, **I want** to publish CloudEvents to my workspace's Kafka topic **so that** other services and functions can react to business events, with the gateway enforcing the `data.kafka.topics` plan capability and a rate limit of 180 req/min.

**Tenant context:** Events family has `tenantBinding: required` and `workspaceBinding: required`. Topic naming policy embeds `{tenantId}.{workspaceId}`. Audit context fields include `target_tenant_id`, `target_workspace_id`.

**Acceptance criteria:**

- GIVEN plan includes `data.kafka.topics` and topic exists
  WHEN `POST /v1/events/topics/{resourceId}/publish` is sent with `Content-Type: application/cloudevents+json`
  THEN event is accepted, validated, and published to workspace Kafka topic; HTTP 200.

- GIVEN 181 requests are sent within a 60-second window
  WHEN the `event_gateway` QoS rate limiter evaluates
  THEN the 181st request returns 429 `Too Many Requests`.

- GIVEN plan does NOT include `data.kafka.topics`
  WHEN the gateway evaluates the events family
  THEN 403 `capability_denied` before reaching the event-gateway.

- Cross-tenant probe: `ten_A` integrator cannot publish to `ten_B.wrk_B1` topics; workspace binding blocks cross-tenant topic access.

**Linked:** uc-events-01 / fn-events-01 / fn-events-02 / cap-events

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` integrator; navigate to `/console/kafka` (`apps/web-console/src/pages/ConsoleKafkaPage.tsx`).
2. Identify a workspace topic; publish a CloudEvent to `POST /v1/events/topics/{resourceId}/publish`.
3. Assert HTTP 200; event appears on the topic.
4. Send 182 requests in 60 s; assert the 182nd returns 429.
5. Sign in as `ten_B` integrator without `data.kafka.topics`; attempt publish; assert 403.

---

### us-events-02

**As a** workspace developer, **I want** to attach a Kafka-topic trigger to a serverless function **so that** the function is automatically invoked when matching messages arrive on the workspace topic.

**Tenant context:** Trigger record links `functionId` to a workspace Kafka topic within the same tenant and workspace. Function quota enforcement applies.

**Acceptance criteria:**

- GIVEN function `fn_A1` exists in `wrk_A1` and a Kafka topic exists in the same workspace
  WHEN `POST /v1/functions/fn_A1/kafka-trigger` is submitted with topic reference
  THEN trigger record created linking function to topic; `SUPPORTED_FUNCTION_TRIGGER_KINDS` includes `kafka_trigger`; function invoked on each matching message.

- GIVEN function count quota for `wrk_A1` is at its limit
  WHEN the trigger creation also counts against quota
  THEN `quota.hard_limit_exceeded` event emitted; 422 returned.

**Linked:** uc-events-02 / fn-events-02 / fn-functions-05 / cap-events / cap-functions

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/functions` (`apps/web-console/src/pages/ConsoleFunctionsPage.tsx`).
2. Select a function; click "Add trigger" → "Kafka topic"; select topic; submit.
3. Assert trigger created; publish a test event; assert function activation log shows invocation.

---

## cap-functions

---

### us-fn-01

**As a** workspace developer, **I want** to deploy a serverless function with immutable versioning and quota enforcement **so that** I can ship multiple versions without overwriting history, and new deployments are blocked when my function count quota is exhausted.

**Tenant context:** Function operations scoped to `(tenantId, workspaceId)` via gateway propagated headers. `emitQuotaEnforcementEvent` checks `function_count` dimension at tenant+workspace scope.

**Acceptance criteria:**

- GIVEN plan includes `data.openwhisk.actions` and function count < quota
  WHEN `POST /v1/functions` is submitted with valid source and runtime
  THEN action created in OpenWhisk; `lifecycleGovernance.immutableVersions: true`; audit event with `tenantId`, `workspaceId`, `version`.

- GIVEN function count equals quota
  WHEN a new function is deployed
  THEN `QUOTA_EXCEEDED` returned; `quota.hard_limit_exceeded` event on `console.quota.hard_limit.blocked`.

- GIVEN a new version is submitted for an existing function
  WHEN `POST /v1/functions/{functionId}/versions` is called
  THEN prior version is immutably preserved; version history intact; rollback possible.

- Cross-tenant probe: `ten_A` developer cannot deploy functions into `ten_B.wrk_B1` namespace; workspace binding enforced.

**Linked:** uc-fn-01 / fn-functions-01 / fn-functions-04 / cap-functions

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/functions`.
2. Click "Deploy function"; upload source code; select runtime; submit.
3. Assert function appears with `tenantId = ten_A`, `version = 1`.
4. Deploy a second version; assert version history shows both.
5. Exhaust quota; attempt deploy; assert `quota.hard_limit_exceeded`.

---

### us-fn-02

**As an** external-application integrator, **I want** to invoke a function synchronously via the `functions_public` capability **so that** I receive a response from the function's execution in a single HTTP roundtrip.

**Tenant context:** Invocation envelope carries `tenantId`, `workspaceId`, `correlationId` as activation annotation (`buildConsoleBackendInvocationEnvelope`). `functions_public` capability required.

**Acceptance criteria:**

- GIVEN plan includes `functions_public` and function exists
  WHEN `POST /v1/functions/{functionId}/invoke` is submitted with `responseMode` and `triggerContext.kind='direct'`
  THEN OpenWhisk activation dispatched; synchronous response awaited; audit event emitted with `tenantId`, `workspaceId`.

- GIVEN `functions_public` capability is absent
  WHEN the gateway evaluates the route
  THEN 403 capability_denied before the invocation reaches control-plane.

- GIVEN `responseMode` is missing
  WHEN `validateConsoleBackendInvocationRequest` validates the request
  THEN validation error thrown; invocation blocked.

**Linked:** uc-fn-02 / fn-functions-02 / cap-functions

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` integrator with `functions_public` in plan.
2. Navigate to `/console/functions`; select a deployed function; click "Invoke".
3. Provide test payload; assert synchronous response displayed.
4. Remove `responseMode`; assert validation error.
5. Sign in without `functions_public`; attempt invocation; assert 403.

---

### us-fn-03

**As a** workspace developer, **I want** to create a cron trigger for a function **so that** it runs on a schedule, with the scheduling engine enforcing a minimum 60-second interval, quota limits, and the three-level config waterfall.

**Tenant context:** Scheduling job record carries `tenant_id`, `workspace_id`. Config resolved via waterfall: workspace-specific → tenant-level → env defaults (`services/scheduling-engine/src/config-model.mjs:3-28`). Quota check: `SELECT COUNT WHERE tenant_id=$1 AND workspace_id=$2`.

**Acceptance criteria:**

- GIVEN scheduling is enabled for `wrk_A1`, cron expression fires >= 60 s, active jobs < `max_active_jobs`
  WHEN `POST /v1/functions/{functionId}/cron-trigger` is submitted with valid cron expression
  THEN `buildJobRecord` creates job with `tenant_id=ten_A`, `workspace_id=wrk_A1`, `status='active'`; `next_run_at` computed.

- GIVEN cron expression would fire every 10 seconds (< 60 s floor)
  WHEN `assertCronFloor` evaluates
  THEN error returned; job not created.

- GIVEN active job count equals `max_active_jobs`
  WHEN `checkJobCreationQuota` evaluates
  THEN `{ allowed: false }` returned; 422 + `quota.hard_limit_exceeded` audit event.

- GIVEN `scheduling_enabled=false` for `wrk_A1` (config waterfall returns false)
  WHEN job creation is attempted
  THEN `isSchedulingEnabled` returns `false`; 422 returned.

- Cross-tenant probe: a cron job for `ten_A.wrk_A1` cannot be accessed or modified by `ten_B` queries; `WHERE tenant_id=$1 AND workspace_id=$2` enforces isolation.

**Linked:** uc-fn-03 / uc-sched-01 / fn-functions-05 / fn-scheduling-01 / fn-scheduling-04 / fn-scheduling-05 / cap-functions / cap-scheduling

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/functions`.
2. Select a function; click "Add trigger" → "Cron"; enter `0 * * * *` (every hour); submit.
3. Assert job created with `status='active'` and `next_run_at` set.
4. Enter `*/5 * * * * *` (every 5 s); assert `assertCronFloor` rejects.
5. Fill quota; create another job; assert quota rejection.

---

### us-fn-04

**As a** workspace developer, **I want** to import a function bundle (actions, packages, triggers, rules) **so that** I can migrate a set of functions from another environment, with the bundle's scope validated against my workspace and credential references redacted.

**Tenant context:** Import scope validated by `buildScopeValidatedImportRequest`; bundle scoped to `(tenantId, workspaceId)`. Actor's `tenantId` must match the bundle scope.

**Acceptance criteria:**

- GIVEN a valid bundle structure with actions, packages, triggers, rules
  WHEN `POST /v1/functions/import` is submitted by `wrk_A1` developer
  THEN `validateImportBundle` passes; all resources created in OpenWhisk namespace; credential references redacted; audit event per resource.

- GIVEN bundle has invalid structure
  WHEN `validateImportBundle` evaluates
  THEN `IMPORT_ERROR_CODES` response returned with details.

- GIVEN bundle scoped to `ten_B.wrk_B1`
  WHEN `buildScopeValidatedImportRequest` validates
  THEN scope mismatch detected; import rejected.

**Linked:** uc-fn-04 / fn-functions-06 / cap-functions

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/functions`.
2. Click "Import bundle"; upload a valid JSON bundle; submit.
3. Assert all functions/packages/triggers/rules appear in the workspace.
4. Upload a bundle scoped to `ten_B.wrk_B1`; assert scope mismatch rejection.

---

## cap-webhooks

---

### us-wh-01

**As a** workspace developer, **I want** to create a webhook subscription targeting an HTTPS endpoint **so that** workspace events are delivered to my service, while the platform's SSRF guard prevents me from accidentally pointing to internal infrastructure.

**Tenant context:** Subscription record carries `tenant_id=ten_A`, `workspace_id=wrk_A1`, `created_by=actorId`. Table indexed on `(tenant_id, workspace_id)` — no other tenant can access this record.

**Acceptance criteria:**

- GIVEN `webhooks` capability in plan and a valid HTTPS target URL pointing to a public host
  WHEN `POST /v1/workspaces/wrk_A1/webhooks` is submitted
  THEN `buildSubscriptionRecord` creates a record with `status='active'`, `max_consecutive_failures=5`; indexed on `(tenant_id, workspace_id)`; HTTP 201.

- GIVEN target URL uses `http://` scheme
  WHEN `validateSubscriptionInput` parses the URL
  THEN `INVALID_URL` returned; subscription not created.

- GIVEN target URL is `https://0x7f000001/hook` (loopback via hex encoding)
  WHEN `normalizeNumericIPv4` resolves the host
  THEN `127.0.0.1` detected; `isBlockedIp` returns true; `INVALID_URL` returned.

- GIVEN target hostname DNS resolves to a private-range IP (e.g., `10.0.0.1`)
  WHEN `lookup(hostname, { all: true })` is called
  THEN all resolved addresses are checked; blocked IP detected; `INVALID_URL` returned.

- GIVEN DNS resolution fails for the hostname
  WHEN `lookup` throws
  THEN fail-closed: `INVALID_URL` returned (no subscription created).

- GIVEN `::ffff:10.0.0.1` (IPv4-mapped IPv6) as target
  WHEN `isBlockedIp` evaluates
  THEN returns `true`; `INVALID_URL` (`services/webhook-engine/src/webhook-subscription.mjs:99-101`).

- GIVEN plan does NOT include `webhooks` capability
  WHEN the gateway evaluates the route
  THEN 403 capability_denied before any validation.

- Cross-tenant probe: a `ten_B` developer cannot read `ten_A.wrk_A1` subscriptions; `(tenant_id, workspace_id)` index enforces access boundary.

**Linked:** uc-wh-01 / fn-webhooks-01 / fn-webhooks-02 / fn-isolation-03 / cap-webhooks

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to a webhook management page (API-only if no UI exists).
2. Submit `POST /v1/workspaces/wrk_A1/webhooks` with `targetUrl: 'https://valid.example.com/hook'`; assert 201.
3. Retry with `http://` URL; assert `INVALID_URL`.
4. Retry with `https://127.0.0.1/hook`; assert `INVALID_URL`.
5. Retry with `https://0x7f000001/hook`; assert `INVALID_URL` (hex loopback normalization).
6. Sign in as `ten_B` developer; query `ten_A.wrk_A1` subscriptions; assert empty result (no 403 — just empty due to index scoping).

---

### us-wh-02

**As a** workspace developer, **I want** to pause an active webhook subscription and later reactivate it **so that** I can temporarily stop event delivery without permanently deleting the subscription.

**Tenant context:** All queries to `webhook_subscriptions` filter by `(tenant_id, workspace_id)`.

**Acceptance criteria:**

- GIVEN subscription `sub_A1_1` is `active`
  WHEN `PATCH /v1/workspaces/wrk_A1/webhooks/sub_A1_1` with `{ status: 'paused' }` is submitted
  THEN `canTransition('active', 'paused')` = `true`; record updated; delivery pauses.

- GIVEN subscription is `paused`
  WHEN `PATCH` with `{ status: 'active' }` is submitted
  THEN `canTransition('paused', 'active')` = `true`; delivery resumes.

- GIVEN subscription is `disabled`
  WHEN `PATCH` with `{ status: 'paused' }` is submitted
  THEN `canTransition('disabled', 'paused')` = `false`; `INVALID_STATUS_TRANSITION` returned.

- GIVEN subscription is `deleted` (terminal)
  WHEN any transition is attempted
  THEN empty transitions set → `INVALID_STATUS_TRANSITION`.

**Linked:** uc-wh-02 / fn-webhooks-03 / cap-webhooks

**UI/API flow (Playwright script):**
1. Create a subscription; assert `status = 'active'`.
2. Submit `PATCH` with `status: 'paused'`; assert `status = 'paused'`.
3. Submit `PATCH` with `status: 'active'`; assert `status = 'active'` again.
4. Manually set status to `disabled`; attempt `PATCH` with `status: 'paused'`; assert `INVALID_STATUS_TRANSITION`.

---

### us-wh-03

**As a** workspace developer, **I want** failed webhook deliveries to be tracked with attempt metadata **so that** I can investigate delivery failures and the subscription is automatically disabled after hitting the max consecutive failure threshold.

**Tenant context:** Delivery records carry `tenant_id` + `workspace_id` via subscription association.

**Acceptance criteria:**

- GIVEN a delivery fails
  WHEN the engine records the attempt
  THEN `webhook_delivery_attempts` row inserted with `attempt_num`, `http_status`, `response_ms`, `error_detail`, `outcome`.

- GIVEN `(subscription_id, event_id)` has already been delivered
  WHEN a duplicate delivery is attempted
  THEN `UNIQUE (subscription_id, event_id)` on `webhook_deliveries` prevents a duplicate delivery record.

- GIVEN `consecutive_failures >= max_consecutive_failures` (default 5)
  WHEN the engine processes another failure
  THEN subscription transitions to `disabled` (or `errored`) status; no further delivery attempts.

**Linked:** fn-webhooks-04 / fn-webhooks-03 / cap-webhooks

**UI/API flow (Playwright script):**
1. Create a subscription pointing to a deliberately failing endpoint.
2. Trigger 5 event deliveries; assert each creates a `webhook_delivery_attempts` row.
3. After the 5th failure, assert subscription status transitions to `disabled`.
4. Verify `(subscription_id, event_id)` uniqueness by replaying the same event; assert no duplicate delivery attempt row.

---

## cap-scheduling

---

### us-sched-01

**As a** workspace developer, **I want** to create and manage cron scheduled jobs **so that** my OpenWhisk actions run on a predictable schedule, with quota enforcement and a minimum interval floor protecting the platform from abusive schedules.

**Tenant context:** `scheduled_jobs` and `scheduling_configurations` both carry `(tenant_id, workspace_id)`. Config waterfall: workspace-specific → tenant-level (`workspace_id IS NULL`) → env defaults. Quota count uses `WHERE tenant_id=$1 AND workspace_id=$2`.

**Acceptance criteria:**

- GIVEN scheduling enabled, cron interval >= 60 s, active jobs < quota
  WHEN job is created via the scheduling API
  THEN `buildJobRecord` creates row with `tenant_id=ten_A`, `workspace_id=wrk_A1`, `status='active'`; `next_run_at` computed; `upsertConfig` idempotent.

- GIVEN job is `active`
  WHEN `PATCH` with `status: 'paused'` is submitted
  THEN `canTransition('active', 'paused')` = `true`; `status = 'paused'`.

- GIVEN job is `paused`
  WHEN resume is attempted (same as cron resume quota check)
  THEN `checkResumeQuota` delegates to `checkJobCreationQuota`; if below limit, job resumes.

- Cross-tenant probe: `ten_B` cannot read or modify jobs belonging to `ten_A.wrk_A1`; `WHERE tenant_id=$1 AND workspace_id=$2` index scoping.

**Linked:** uc-sched-01 / fn-scheduling-01 / fn-scheduling-03 / fn-scheduling-04 / fn-scheduling-05 / fn-isolation-04 / cap-scheduling

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer.
2. Create a cron job via `POST /v1/workspaces/wrk_A1/schedules`; assert created with `status='active'`.
3. Pause it; assert `status='paused'`.
4. Resume it; assert `status='active'`.
5. Sign in as `ten_B` developer; query `ten_A.wrk_A1` jobs; assert empty result.

---

### us-sched-02

**As a** workspace developer, **I want** the platform to automatically move a cron job to `errored` state after N consecutive execution failures **so that** the scheduler stops attempting runs on a broken action without requiring manual intervention.

**Tenant context:** Failure tracking operates on the job record's `(tenant_id, workspace_id)`. No cross-tenant data accessed.

**Acceptance criteria:**

- GIVEN job `max_consecutive_failures = 3`, current `consecutive_failure_count = 2`
  WHEN a third consecutive execution fails
  THEN `incrementFailureCount` sets `consecutive_failure_count = 3`; since `3 >= 3`, `status = 'errored'`.

- GIVEN a successful execution follows failures
  WHEN `resetFailureCount` is called
  THEN `consecutive_failure_count = 0`; job remains `active`.

- GIVEN job is in `errored` state
  WHEN a transition to `active` is attempted
  THEN `canTransition('errored', 'active')` = `false`; error thrown; only valid transition is `deleted`.

**Linked:** uc-sched-02 / fn-scheduling-02 / fn-scheduling-03 / cap-scheduling

**UI/API flow (Playwright script):**
1. Create a job pointing to a failing action.
2. Trigger 3 consecutive failures.
3. Assert job `status = 'errored'` in the job model.
4. Attempt to reactivate the errored job; assert `INVALID_STATUS_TRANSITION`.
5. Delete the errored job; assert `status = 'deleted'` (terminal).

---

## cap-backup-restore

---

### us-backup-01

**As a** tenant owner, **I want** to trigger an on-demand backup of my database instance **so that** I have a point-in-time recovery option, with the system blocking concurrent backup operations and returning a trackable operation ID.

**Tenant context:** `backup:write:own` scope restricts the actor to operate only on their own `tenantId`. The scope check `token.tenantId !== tenant_id → 403` is explicit in `trigger-backup.action.ts:97-99`. Platform SREs with `backup:write:global` can act across tenants.

**Acceptance criteria:**

- GIVEN `BACKUP_ENABLED=true`, actor has `backup:write:own`, component supports `triggerBackup`, no concurrent operation active
  WHEN `POST /v1/admin/backup/trigger` is submitted with own `tenant_id`
  THEN operation record created; `backup.requested` audit event emitted; HTTP 202 with `{ operation_id, status: 'accepted', accepted_at }`.

- GIVEN an active backup operation already exists for `(tenant_id, component_type, instance_id)`
  WHEN `repo.findActive` finds it
  THEN 409 returned with `conflict_operation_id`.

- GIVEN `BACKUP_ENABLED=false`
  WHEN the deployment check runs
  THEN 501 returned.

- Cross-tenant probe: `ten_A` owner with `backup:write:own` targeting `tenant_id = ten_B` receives 403 + `backup.rejected` audit event with `rejectionReason: 'cross_tenant_not_allowed'`.

**Linked:** uc-backup-01 / uc-backup-02 / fn-backup-01 / fn-backup-02 / fn-backup-03 / cap-backup-restore

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` owner.
2. Navigate to the backup page (`apps/web-console/src/pages/admin/BackupStatusPage.tsx` or `apps/web-console/src/pages/tenant/BackupSummaryPage.tsx`).
3. Click "Trigger backup" (`apps/web-console/src/components/backup/TriggerBackupButton.tsx`); confirm.
4. Assert HTTP 202 with `operation_id`; poll operation status.
5. Trigger a second backup while the first is active; assert 409 with `conflict_operation_id`.
6. Attempt `POST /v1/admin/backup/trigger` with `tenant_id = ten_B`; assert 403 + `backup.rejected` audit event.

---

### us-backup-02

**As a** platform SRE, **I want** to trigger backups for any tenant using the `backup:write:global` scope **so that** I can fulfil disaster-recovery obligations across the entire platform without being restricted to a single tenant.

**Tenant context:** SRE's `backup:write:global` scope bypasses the `token.tenantId !== tenant_id` guard. Audit events carry the target `tenantId` separately from the SRE's own identity.

**Acceptance criteria:**

- GIVEN SRE has `backup:write:global`
  WHEN `POST /v1/admin/backup/trigger` is submitted with any `tenant_id`
  THEN `!hasWriteGlobal` = `false`; cross-tenant guard is skipped; operation created for the target tenant.

- GIVEN SRE has only `backup:write:own` (not global)
  WHEN `POST /v1/admin/backup/trigger` is submitted with a different `tenant_id`
  THEN 403 returned.

**Linked:** fn-backup-02 / cap-backup-restore

**UI/API flow (Playwright script):**
1. Sign in as SRE with `backup:write:global`.
2. Submit backup trigger for `ten_B`; assert 202 and operation created.
3. Downgrade to `backup:write:own`; retry for `ten_B`; assert 403.

---

## cap-quotas-plans

---

### us-quota-01

**As a** tenant administrator, **I want** to see which plan capabilities are enabled for my tenant **so that** I know which API families I can access and understand why some features return 403.

**Tenant context:** `resolveTenantEffectiveCapabilities` intersects `plan.capabilityKeys` with `deploymentProfile.providerCapabilityIds`. `resolveWorkspaceEffectiveCapabilities` further filters by `allowedEnvironments`.

**Acceptance criteria:**

- GIVEN `ten_A` is on plan `starter` (no `identity.sso.oidc`)
  WHEN the tenant views the plan overview at `/console/my-plan` (`apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx`)
  THEN `identity.sso.oidc` is NOT listed as enabled; the IAM section is marked capability-gated.

- GIVEN `ten_A` plan includes `data.storage.bucket`
  WHEN the tenant accesses `GET /v1/storage/buckets`
  THEN request passes the capability gate; response returned.

- GIVEN `ten_A` plan does NOT include `data.storage.bucket`
  WHEN the tenant accesses `GET /v1/storage/buckets`
  THEN 403 `capability_denied` returned; `capabilityEnforcementDeniedEvent` audit event emitted with extended retention.

- GIVEN workspace `wrk_A1` is in `staging` environment and the capability is `production_only`
  WHEN `resolveWorkspaceEffectiveCapabilities` filters
  THEN the capability is excluded for this workspace even if the tenant plan includes it.

**Linked:** uc-quota-01 / fn-quotas-01 / fn-quotas-02 / fn-quotas-03 / cap-quotas-plans

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin; navigate to `/console/my-plan`.
2. Assert capabilities list shows `data.storage.bucket` enabled and `identity.sso.oidc` absent (starter plan).
3. Navigate to `/console/storage`; assert storage page loads (capability present).
4. Attempt `POST /v1/admin/iam/clients`; assert 403 (capability absent).

---

### us-quota-02

**As a** workspace developer, **I want** the system to reject writes that exceed hard quota limits and emit an audit event **so that** the platform is protected from resource abuse and I receive a clear error message.

**Tenant context:** Quota count scoped to `(tenant_id, workspace_id)`. Hard-limit audit event published to `console.quota.hard_limit.blocked`.

**Acceptance criteria:**

- GIVEN active scheduled job count for `wrk_A1` equals `max_active_jobs`
  WHEN another job creation is attempted
  THEN `checkJobCreationQuota` returns `{ allowed: false, reason: '...' }`; 422 returned; `quota.hard_limit_exceeded` event on `console.quota.hard_limit.blocked`.

- GIVEN Kafka topic count for `wrk_A1` equals `workspace.kafka_topics.max`
  WHEN a new topic creation is attempted
  THEN same hard-limit enforcement pattern applies.

- Cross-tenant probe: quota counts are scoped to `(ten_A, wrk_A1)` and do not affect `ten_B.wrk_B1` quotas.

**Linked:** uc-quota-02 / fn-quotas-04 / fn-scheduling-01 / cap-quotas-plans

**UI/API flow (Playwright script):**
1. Sign in as `wrk_A1` developer; navigate to `/console/quotas` (`apps/web-console/src/pages/ConsoleQuotasPage.tsx`).
2. Fill the scheduling quota (create N jobs up to `max_active_jobs`).
3. Attempt to create one more; assert 422 with quota reason in body.
4. Assert `quota.hard_limit_exceeded` event on Kafka topic `console.quota.hard_limit.blocked`.
5. Verify `ten_B.wrk_B1` quota is unaffected.

---

### us-quota-03

**As a** platform operator, **I want** to create and assign plans with specific capability keys and quota defaults **so that** different tenants get different feature sets, and plan upgrades are validated before being applied.

**Tenant context:** Plan management is platform-scoped; `RequireSuperadminRoute` guards `/console/plans/*` routes (`apps/web-console/src/router.tsx:156-165`).

**Acceptance criteria:**

- GIVEN a superadmin is authenticated
  WHEN navigating to `/console/plans/new` (`apps/web-console/src/pages/ConsolePlanCreatePage.tsx`)
  THEN the plan creation form is accessible.

- GIVEN a superadmin navigates to `/console/tenants/{tenantId}/plan`
  WHEN a plan change is confirmed
  THEN the tenant's `planId` is updated; `resolveTenantEffectiveCapabilities` re-resolves with the new plan.

- GIVEN a non-superadmin navigates to `/console/plans`
  WHEN `RequireSuperadminRoute` checks `session.principal.platformRoles`
  THEN redirect to `/console/my-plan` occurs (`apps/web-console/src/router.tsx:96-100`).

**Linked:** fn-quotas-01 / fn-quotas-02 / cap-quotas-plans

**UI/API flow (Playwright script):**
1. Sign in as superadmin; navigate to `/console/plans/new`.
2. Fill in plan name, capability keys, quota defaults; submit.
3. Navigate to `/console/tenants/ten_A/plan`; assign the new plan; confirm.
4. Sign in as `ten_A` admin; navigate to `/console/my-plan`; assert new capabilities are listed.
5. Sign in as `ten_A` admin (non-superadmin); navigate to `/console/plans`; assert redirect to `/console/my-plan`.

---

## cap-audit

---

### us-audit-01

**As a** tenant administrator, **I want** to query audit events for my tenant with cursor-based pagination, time window filters, and sort options **so that** I can investigate incidents and demonstrate compliance.

**Tenant context:** `assertScopeBinding` enforces `context.tenantId === params.tenantId`; cross-tenant query blocked. Masking applied via `buildMaskedAuditItems` before delivery.

**Acceptance criteria:**

- GIVEN authenticated `ten_A` admin
  WHEN `GET /v1/admin/audit/events?scope=tenant&tenantId=ten_A&limit=50` is submitted
  THEN results returned with `{ items, page: { nextCursor, hasMore }, queryScope }` for `ten_A` only; each item is masked.

- GIVEN `tenantId` in query differs from `context.tenantId`
  WHEN `assertScopeBinding` evaluates
  THEN `AUDIT_QUERY_SCOPE_VIOLATION` returned; HTTP 403.

- GIVEN `limit > 200` (max_limit)
  WHEN `normalizeLimit` evaluates
  THEN `AUDIT_QUERY_LIMIT_EXCEEDED` returned.

- GIVEN `occurredAfter > occurredBefore`
  WHEN `normalizeTimeWindow` evaluates
  THEN `AUDIT_QUERY_INVALID_TIME_WINDOW` returned.

- Cross-tenant probe: `ten_A` admin querying `tenantId=ten_B` receives `AUDIT_QUERY_SCOPE_VIOLATION`.

**Linked:** uc-audit-01 / fn-audit-01 / fn-audit-02 / cap-audit

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin; navigate to `/console/observability` (`apps/web-console/src/pages/ConsoleObservabilityPage.tsx`).
2. Open audit events tab; set time window; submit query.
3. Assert paginated results with `nextCursor`; items masked.
4. Submit query with `tenantId=ten_B`; assert `AUDIT_QUERY_SCOPE_VIOLATION`.
5. Submit query with `limit=300`; assert `AUDIT_QUERY_LIMIT_EXCEEDED`.

---

### us-audit-02

**As a** tenant administrator, **I want** to correlate audit events across subsystems by `correlationId` **so that** I can reconstruct the full timeline of a provisioning or mutation request spanning multiple services.

**Tenant context:** Correlation query must stay within the caller's tenant scope. Masking profiles validated for compatibility before delivering correlated events.

**Acceptance criteria:**

- GIVEN events from multiple subsystems carry the same `correlationId`
  WHEN `GET /v1/admin/audit/correlate/{correlationId}` is submitted by `ten_A` admin
  THEN timeline built with phases from `listAuditCorrelationTimelinePhases`; downstream trace sources surfaced.

- GIVEN masking profile incompatibility exists between correlated events
  WHEN `getAuditCorrelationMaskingCompatibility` validates
  THEN validation error returned before data delivery.

- GIVEN `correlationId` not found
  WHEN query executes
  THEN empty timeline returned; no error.

**Linked:** uc-audit-02 / fn-audit-04 / cap-audit

**UI/API flow (Playwright script):**
1. Trigger a multi-step operation (e.g., workspace creation) and capture its `X-Correlation-Id`.
2. Navigate to `/console/observability`; open the correlation view; enter the `correlationId`.
3. Assert timeline shows events from multiple subsystems (control-plane, Keycloak, storage, Kafka).
4. Enter a non-existent `correlationId`; assert empty timeline returned gracefully.

---

### us-audit-03

**As a** tenant administrator, **I want** to export audit events in a structured format with field masking applied **so that** I can produce compliance reports without exposing sensitive field values.

**Tenant context:** Export scope validated before data delivery. Sensitive field masking rules from `getAuditExportSensitiveFieldRules`.

**Acceptance criteria:**

- GIVEN authenticated `ten_A` admin
  WHEN `POST /v1/admin/audit/export` is submitted with a valid masking profile and format (JSON or CSV)
  THEN export artifact returned with sensitive fields masked per `listAuditExportMaskingProfiles`; scope limited to `ten_A`.

- GIVEN masking profile is incompatible with correlation surface
  WHEN `listAuditExportMaskingProfiles` validates
  THEN validation error returned before export begins.

- Cross-tenant probe: export scoped to `ten_B` by `ten_A` admin returns scope violation.

**Linked:** fn-audit-03 / cap-audit

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` admin; navigate to `/console/observability`.
2. Select "Export audit"; choose JSON format and a masking profile; submit.
3. Assert export artifact contains only `ten_A` events with sensitive fields redacted.
4. Attempt export scoped to `ten_B`; assert scope violation.

---

## cap-gateway

---

### us-gw-01

**As any** authenticated client, **I want** mutations I submit with an `Idempotency-Key` to be deduplicated by the gateway for 24 hours **so that** network retries never cause double-writes.

**Tenant context:** Idempotency is keyed by `sha256(requestBody) + Idempotency-Key`; tenant-unaware at the gateway level but scoped by body content.

**Acceptance criteria:**

- GIVEN a successful `POST /v1/workspaces` with `Idempotency-Key: <uuid>`
  WHEN the same request is replayed with the same key and body within 86400 s
  THEN the cached response is returned; `X-Idempotency-Replayed: true` header present; no second workflow dispatched.

- GIVEN a `POST` mutation without an `Idempotency-Key` header
  WHEN the gateway validates the request
  THEN 400 `Missing Idempotency-Key` returned (except `observability` and `native_admin` profiles which are exempt).

- GIVEN an `observability` profile route receives a POST without `Idempotency-Key`
  WHEN the gateway evaluates `requireIdempotencyHeaderOnMutations`
  THEN the request is processed normally (exempt profile).

**Linked:** uc-gw-01 / fn-ctx-02 / cap-gateway

**UI/API flow (Playwright script):**
1. Submit `POST /v1/workspaces` with a unique `Idempotency-Key`; assert 202 and `jobRef`.
2. Replay the exact same request; assert `X-Idempotency-Replayed: true`; assert no new job created.
3. Submit `POST /v1/workspaces` without `Idempotency-Key`; assert 400.
4. Submit a mutation to an observability endpoint without `Idempotency-Key`; assert it is accepted.

---

### us-gw-02

**As a** workspace developer on a restricted plan, **I want** the gateway to deny access to capability-gated routes before my request even reaches the backend **so that** I receive a clear and immediate 403 rather than an opaque backend error.

**Tenant context:** `X-Plan-Id` resolved from JWT claim; APISIX evaluates capability gates per-tenant at the gateway layer. Denial emits `capabilityEnforcementDeniedEvent` with security category and extended retention.

**Acceptance criteria:**

- GIVEN plan does NOT include `realtime` capability
  WHEN WebSocket upgrade to `GET /v1/workspaces/wrk_A1/realtime` is initiated
  THEN 403 returned before WebSocket upgrade completes; `capabilityEnforcementDeniedEvent` audit event emitted.

- GIVEN plan does NOT include `passthrough_admin`
  WHEN `GET /v1/workspaces/wrk_A1/admin/passthrough/*` is requested
  THEN 403 returned at APISIX; backend never receives the request.

**Five capability-gated route families (code-confirmed):**

| Capability | Blocked routes |
|---|---|
| `webhooks` | `/v1/workspaces/*/webhooks*` |
| `realtime` | `/v1/workspaces/*/realtime*`, `GET /v1/events/subscribe` |
| `sql_admin_api` | `/v1/workspaces/*/sql*`, `/v1/workspaces/*/admin/sql*` |
| `passthrough_admin` | `/v1/workspaces/*/admin/passthrough*` |
| `functions_public` | `POST /v1/functions/*/invoke`, `/v1/workspaces/*/functions/public*` |

Code: `services/gateway-config/routes/capability-gated-routes.yaml:15-44`

**Linked:** uc-gw-02 / fn-gateway-01 / fn-quotas-03 / cap-gateway

**UI/API flow (Playwright script):**
1. Sign in as `ten_A` developer on plan without `realtime`.
2. Attempt WebSocket upgrade to `/v1/workspaces/wrk_A1/realtime`; assert 403.
3. Assert `capabilityEnforcementDeniedEvent` audit event emitted in the security log.
4. Add `realtime` to the plan (via platform operator); retry WebSocket upgrade; assert connection succeeds.

---

## Summary

| Story ID | Title | Capability | Role | uc/fn links |
|---|---|---|---|---|
| us-tenant-01 | Provision new tenant | cap-tenant-provisioning | Platform operator | uc-tenant-01 |
| us-tenant-02 | Suspend tenant | cap-tenant-lifecycle | Platform operator | uc-tenant-02 |
| us-tenant-03 | Purge soft-deleted tenant | cap-tenant-lifecycle | Platform operator | uc-tenant-03 |
| us-tenant-04 | Export tenant config | cap-tenant-lifecycle | Tenant admin | uc-tenant-04 |
| us-workspace-01 | Create workspace | cap-workspace-lifecycle | Tenant admin | uc-workspace-01 |
| us-workspace-02 | Clone workspace | cap-workspace-lifecycle | Tenant admin | uc-workspace-02 |
| us-auth-01 | Console login | cap-auth-console | Workspace member | uc-auth-01 |
| us-auth-02 | Signup with pending activation | cap-auth-console | Anonymous | uc-auth-02 |
| us-auth-03 | Approve pending user | cap-auth-console | Workspace admin | uc-auth-03 |
| us-iam-01 | Create OIDC client | cap-iam-admin | Tenant admin | uc-iam-01 |
| us-iam-02 | Create/rotate service account | cap-external-apps-service-accounts | Workspace developer | uc-iam-02 |
| us-sec-01 | JWT validation and context propagation | cap-token-validation | Any actor | uc-token-01 |
| us-sec-02 | Reject spoofed tenant headers | cap-context-propagation | Security auditor | uc-ctx-01 |
| us-pg-01 | Provision Postgres database | cap-postgres-data-api | Workspace developer | uc-pg-01 |
| us-pg-02 | Admin SQL execution | cap-postgres-data-api | Workspace developer | uc-pg-02 |
| us-pg-03 | Enable Postgres CDC | cap-pg-cdc | Workspace developer | uc-pg-cdc-01 |
| us-mongo-01 | Enable MongoDB CDC | cap-mongo-cdc | Workspace developer | uc-mongo-01 |
| us-storage-01 | Create storage bucket | cap-storage | Tenant admin | uc-storage-01 |
| us-storage-02 | Issue/rotate storage credentials | cap-storage | Tenant admin | uc-storage-02 |
| us-storage-03 | Import objects with manifest | cap-storage | Workspace developer | uc-storage-03 |
| us-storage-04 | View storage usage | cap-storage | Workspace developer | fn-storage-05 |
| us-realtime-01 | Open WebSocket session | cap-realtime | External integrator | uc-realtime-01 |
| us-realtime-02 | Token expiry suspends session | cap-realtime | External integrator | uc-realtime-02 |
| us-realtime-03 | Resume suspended session | cap-realtime | External integrator | uc-realtime-03 |
| us-events-01 | Publish CloudEvent | cap-events | External integrator | uc-events-01 |
| us-events-02 | Kafka trigger for function | cap-events/cap-functions | Workspace developer | uc-events-02 |
| us-fn-01 | Deploy serverless function | cap-functions | Workspace developer | uc-fn-01 |
| us-fn-02 | Invoke function synchronously | cap-functions | External integrator | uc-fn-02 |
| us-fn-03 | Create cron trigger | cap-functions/cap-scheduling | Workspace developer | uc-fn-03 |
| us-fn-04 | Import function bundle | cap-functions | Workspace developer | uc-fn-04 |
| us-wh-01 | Create webhook (SSRF guard) | cap-webhooks | Workspace developer | uc-wh-01 |
| us-wh-02 | Pause/reactivate webhook | cap-webhooks | Workspace developer | uc-wh-02 |
| us-wh-03 | Delivery attempt tracking | cap-webhooks | Workspace developer | fn-webhooks-04 |
| us-sched-01 | Create/manage cron jobs | cap-scheduling | Workspace developer | uc-sched-01 |
| us-sched-02 | Auto-error on failures | cap-scheduling | Workspace developer | uc-sched-02 |
| us-backup-01 | Trigger on-demand backup | cap-backup-restore | Tenant owner | uc-backup-01/02 |
| us-backup-02 | SRE cross-tenant backup | cap-backup-restore | Platform SRE | fn-backup-02 |
| us-quota-01 | View plan capabilities | cap-quotas-plans | Tenant admin | uc-quota-01 |
| us-quota-02 | Hard quota limit rejection | cap-quotas-plans | Workspace developer | uc-quota-02 |
| us-quota-03 | Create and assign plans | cap-quotas-plans | Platform operator | fn-quotas-01/02 |
| us-audit-01 | Query tenant audit events | cap-audit | Tenant admin | uc-audit-01 |
| us-audit-02 | Correlate by correlationId | cap-audit | Tenant admin | uc-audit-02 |
| us-audit-03 | Export audit events | cap-audit | Tenant admin | fn-audit-03 |
| us-gw-01 | Idempotent mutation replay | cap-gateway | Any client | uc-gw-01 |
| us-gw-02 | Capability gate blocks route | cap-gateway | Workspace developer | uc-gw-02 |
| us-flows-01 | Design & publish a flow | cap-workflows | Workspace developer | fn-flows-01/02/03 |
| us-flows-02 | Manual run & live observe | cap-workflows | Workspace developer | fn-flows-04/05 |
| us-flows-03 | Webhook / cron / event triggers | cap-workflows | Workspace developer | fn-flows-06/07/08 |
| us-flows-04 | Failure & retry | cap-workflows | Workspace developer | fn-flows-09/10 |
| us-flows-05 | Human approval gate | cap-workflows | Workspace admin | fn-flows-11 |
| us-flows-06 | Worker-kill resilience | cap-workflows | Platform operator | fn-flows-12 |
| us-flows-07 | Version pinning | cap-workflows | Workspace developer | fn-flows-13 |
| us-flows-08 | Cross-tenant isolation probes | cap-workflows | Security officer | fn-flows-14/15 |

---

## cap-workflows — Flows (Temporal-backed visual workflow engine)

> Added: 2026-06-12. Source branch: feat/add-flows-triggers (epic #355).
> Code anchors: `apps/control-plane/src/runtime/flow-executor.mjs`, `services/workflow-worker/src/workflows/DslInterpreterWorkflow.ts`, `apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx`, `apps/web-console/src/pages/ConsoleFlowRunPage.tsx`.

---

### us-flows-01

**As a** workspace developer, **I want** to build a multi-node flow on the canvas designer, switch to the YAML editor for fine-grained edits, and publish version 1 **so that** the flow is available for execution and I can track its definition history.

**Tenant context:** `ten_A` / `wrk_A1`. Flow definitions live in Postgres under RLS (`tenant_id = identity.tenantId`).

**Acceptance criteria:**

- GIVEN an authenticated workspace developer navigates to `/console/flows`
  WHEN they enter a flow name and click "New flow"
  THEN the designer page opens with a fresh draft; the task-type palette loads from `/v1/flows/workspaces/{ws}/task-types`.

- GIVEN three nodes are placed on the canvas (fetch-record → transform-record → persist-record)
  WHEN "Save draft" is clicked
  THEN the API persists the draft (`PATCH /v1/flows/{ws}/flows/{flowId}`); the "Saved" indicator appears.

- GIVEN the user switches to YAML view
  WHEN the YAML editor renders
  THEN the canonical YAML serialisation of the canvas model is displayed without loss.

- GIVEN the user edits a node description in YAML and switches back to canvas
  WHEN the canvas re-syncs from YAML
  THEN the edited node is reflected on the canvas.

- GIVEN the definition is valid (no FLW-E* errors)
  WHEN the user clicks "Publish"
  THEN `POST /v1/flows/{ws}/flows/{flowId}/versions` returns `{ version: 1 }`; the "v1 published" badge appears.

**Linked:** fn-flows-01, fn-flows-02, fn-flows-03 / `apps/control-plane/src/runtime/flow-executor.mjs::createFlowExecutor`

**E2E spec:** `tests/e2e/specs/flows/flows-design-publish.spec.ts`

---

### us-flows-02

**As a** workspace developer, **I want** to manually start a published flow from the console and watch per-node status badges turn green live **so that** I can confirm the run completed correctly and inspect each node's output.

**Tenant context:** `ten_A` / `wrk_A1`. Execution state lives in Temporal (in `falcone-flows` namespace) scoped by workflow-id prefix `{tenantId}:{workspaceId}:`.

**Acceptance criteria:**

- GIVEN a published flow
  WHEN the developer clicks "Run" in the console
  THEN `POST .../executions` is called; a new `executionId` is returned; the run page navigates to `/console/flows/{flowId}/runs/{executionId}`.

- GIVEN the run is in progress and the user supplies the anon key
  WHEN the SSE stream connects (`GET .../executions/{id}/events?apikey=...`)
  THEN `node-status` events arrive in real time; the canvas badges update to `started` then `completed` for each node.

- GIVEN the run reaches `Completed`
  WHEN the SSE stream closes with a `stream-end` event
  THEN the run page transitions to "Final state from history" and the Cancel button is disabled.

**Linked:** fn-flows-04, fn-flows-05 / `apps/control-plane/src/runtime/flow-monitoring-executor.mjs`

**E2E spec:** `tests/e2e/specs/flows/flows-run-observe.spec.ts`

---

### us-flows-03

**As a** workspace developer, **I want** flows to start automatically from webhooks, cron schedules, and platform events **so that** I can wire integrations without manual intervention.

**Tenant context:** `ten_A` / `wrk_A1`. Trigger registration happens at publish time (`flow-trigger-registry.mjs`); cron = Temporal Schedule; webhook = HMAC-signed HTTP ingestion; platform event = Kafka consumer offset.

**Acceptance criteria:**

- GIVEN a flow with a webhook trigger and a registered HMAC secret
  WHEN a correctly signed `POST /v1/flows/workspaces/{ws}/triggers/webhooks/{triggerId}` is received
  THEN a new execution is started (`201 executionId`).

- GIVEN a flow with a webhook trigger
  WHEN an incorrectly signed POST arrives
  THEN the server returns `401 UNAUTHORIZED` and no execution is started.

- GIVEN a flow with a `* * * * *` cron trigger
  WHEN it is published
  THEN a Temporal Schedule is registered; within 90 s the first execution fires and reaches Completed.

- GIVEN a flow with a `platform-event` trigger bound to `document.created`
  WHEN published
  THEN the Kafka consumer for `document.created` is registered (platform event → execution pipeline active).

**Linked:** fn-flows-06, fn-flows-07, fn-flows-08 / `apps/control-plane/src/runtime/flow-trigger-registry.mjs`

**E2E spec:** `tests/e2e/specs/flows/flows-triggers.spec.ts`

---

### us-flows-04

**As a** workspace developer, **I want** a flow with a failing task to show retries and then enter a terminal failure state, and to be able to trigger a retry from the console that starts a new successful run **so that** transient failures do not permanently block my workflow.

**Tenant context:** `ten_A` / `wrk_A1`. Retry policy is per-node in the DSL; Temporal's RetryPolicy is mapped from the DSL at schedule time (`DslInterpreterWorkflow`).

**Acceptance criteria:**

- GIVEN a flow with a task whose `retryPolicy.maxAttempts=2`
  WHEN the task fails on every attempt
  THEN the execution transitions to `Failed` after exhausting retries.

- GIVEN a failed execution
  WHEN the developer clicks "Retry"
  THEN `POST .../retries` starts a new execution with the same version and input; the new `executionId` differs from the original.

- GIVEN a running execution
  WHEN the developer clicks "Cancel"
  THEN `POST .../cancellations` is called; the execution reaches a terminal state.

**Linked:** fn-flows-09, fn-flows-10 / `apps/web-console/src/components/flows/RunActionToolbar.tsx`

**E2E spec:** `tests/e2e/specs/flows/flows-failure-retry.spec.ts`

---

### us-flows-05

**As a** workspace admin, **I want** a flow to pause at a human-approval node so that I can review the run in the console and resume it by approving or reject it **so that** high-value operations require explicit human sign-off before proceeding.

**Tenant context:** `ten_A` / `wrk_A1`. Approval is a Temporal signal (`flowApproval`); the approval node blocks the workflow coroutine until the signal arrives or the timeout elapses.

**Acceptance criteria:**

- GIVEN a flow with an `approval` node (id: `review`, approvers: `role:workspace_admin`)
  WHEN the execution reaches the approval node
  THEN the node status transitions to `waiting-approval`; the execution status is `Running`.

- GIVEN the approval node is in `waiting-approval`
  WHEN the user opens the run page
  THEN the Approve and Reject buttons are visible in the toolbar.

- GIVEN the Approve button is clicked (with confirmation)
  WHEN `POST .../signals/review` is sent with `{ approved: true }`
  THEN the execution resumes and reaches `Completed`.

- GIVEN the Reject button is clicked
  WHEN `POST .../signals/review` is sent with `{ approved: false }`
  THEN the execution terminates (Failed or Canceled per the workflow implementation).

**Linked:** fn-flows-11 / `apps/control-plane/src/runtime/flow-executor.mjs::APPROVAL_SIGNAL`

**E2E spec:** `tests/e2e/specs/flows/flows-human-approval.spec.ts`

---

### us-flows-06

**As a** platform operator, **I want** a long-running flow to survive a worker pod kill so that when Kubernetes restarts the pod the execution resumes from where it left off with no duplicated or lost node effects **so that** the workflow engine is resilient to normal infrastructure disruptions.

**Tenant context:** `ten_A` / `wrk_A1`. Temporal persists workflow history in PostgreSQL; the DslInterpreterWorkflow is deterministically replayable.

**Acceptance criteria:**

- GIVEN a running flow whose first activity takes 15 s
  WHEN `kubectl delete pod --force` is issued against the worker pod while the activity is in-flight
  THEN Kubernetes creates a replacement worker pod.

- GIVEN the replacement worker pod is Ready
  WHEN Temporal reassigns the in-flight activity
  THEN the execution resumes without restarting completed nodes.

- GIVEN the execution finishes
  WHEN the execution detail is inspected
  THEN the `final-step` node appears exactly once with status `completed` (exactly-once node-effect semantics).

**Linked:** fn-flows-12 / `services/workflow-worker/src/workflows/DslInterpreterWorkflow.ts::WorkflowSideEffectGuard`

**E2E spec:** `tests/e2e/specs/flows/flows-worker-kill.spec.ts`

---

### us-flows-07

**As a** workspace developer, **I want** an in-flight v1 run to complete with v1 behavior even after I publish v2, and subsequent trigger-started runs to use v2 **so that** live runs are never broken by schema changes.

**Tenant context:** `ten_A` / `wrk_A1`. Version is stamped into the `flowVersion` Temporal search attribute at execution start; the workflow reads the pinned version from its start args.

**Acceptance criteria:**

- GIVEN a published v1 flow with an in-flight execution (pinned to `version: 1`)
  WHEN v2 is published (`POST .../versions` returns `{ version: 2 }`)
  THEN the v1 execution completes with v1 definition behavior (unaffected by v2).

- GIVEN v2 is published
  WHEN a new execution is started without an explicit version
  THEN the execution uses v2 definition; its `version` metadata reflects `2`.

**Linked:** fn-flows-13 / `apps/control-plane/src/runtime/flow-executor.mjs::startExecution`

**E2E spec:** `tests/e2e/specs/flows/flows-version-pinning.spec.ts`

---

### us-flows-08

**As a** platform security officer, **I want** tenant B to be unable to see tenant A's flows, executions, or live streams anywhere in the UI or API **so that** tenant data is strictly isolated and there is no information disclosure across tenant boundaries.

**Tenant context:** Cross-tenant probe. Tenant A = `ten_A` / `wrk_A1`; Tenant B = `ten_B` / `wrk_B1`.

**Acceptance criteria:**

- GIVEN tenant A has a published flow and a completed execution
  WHEN tenant B calls `GET /v1/flows/workspaces/wrk_B1/flows/{flowId_A}` (with tenant B's identity headers)
  THEN the server returns 404 (RLS hides the row) or 403.

- GIVEN tenant A's execution has a known `executionId`
  WHEN tenant B calls `GET .../executions/{executionId_A}` (with tenant B's identity)
  THEN the server returns 404 (workflowId prefix mismatch → EXECUTION_NOT_FOUND).

- GIVEN tenant B attempts `POST .../executions/{executionId_A}/cancellations` (mutating verb)
  WHEN the executor evaluates `assertOwnedWorkflowId`
  THEN the response is 403 CROSS_TENANT_FORBIDDEN.

- GIVEN tenant B attempts to send a signal to tenant A's execution
  THEN the response is 403 CROSS_TENANT_FORBIDDEN.

- GIVEN tenant B opens the console Flows page
  WHEN the API lists `wrk_B1` flows
  THEN no tenant A flows appear (RLS enforced at the database query level).

**Linked:** fn-flows-14, fn-flows-15 / `apps/control-plane/src/runtime/flow-executor.mjs::assertOwnedWorkflowId`

**E2E spec:** `tests/e2e/specs/flows/flows-cross-tenant.spec.ts`

