# identity-and-access

## Purpose

This capability owns every authentication, authorization, and identity-administration surface of In Falcone. It mediates console operator login, signup with policy gating, password recovery, and session lifecycle; it exposes a normalized BaaS administration model on top of Keycloak realms, clients, roles, scopes, and users; and it produces the contextual-authorization decisions that the rest of the platform consumes (security context, privilege domains, scope enforcement). Keycloak is the underlying identity provider, with a stable platform realm for operators and per-tenant identity contexts for end users and workspace identities. Every state-mutating action in this capability emits IAM lifecycle events to the audit pipeline.

## Surfaces

- **Public REST endpoints**:
  - `/v1/auth` (`apps/control-plane/openapi/families/auth.openapi.json`) — `POST /v1/auth/access-checks`, `POST /v1/auth/login-sessions`, `DELETE /v1/auth/login-sessions/{sessionId}`, `POST /v1/auth/login-sessions/{sessionId}/refresh`, `POST /v1/auth/password-recovery-requests`, `POST /v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations`, `POST /v1/auth/signups`, `GET /v1/auth/signups/policy`, `GET /v1/auth/signups/{registrationId}`, `POST /v1/auth/signups/{registrationId}/activation-decisions`, `GET /v1/auth/status-views/{statusViewId}`.
  - `/v1/iam` (`apps/control-plane/openapi/families/iam.openapi.json`) — realms (list / create / get / update / delete / set-status), realm clients (list / create / get / update / delete / set-status), realm roles (list / create / get / update / delete), realm client scopes (list / create / get / update / delete), realm users (list / create / get / update / delete / set-status / credential-resets), and per-tenant and per-workspace IAM activity (`GET /v1/iam/tenants/{tenantId}/activity`, `GET /v1/iam/workspaces/{workspaceId}/activity`).
- **Frontend pages**:
  - `LoginPage` → `/login`
  - `SignupPage` → `/signup`
  - `PendingActivationPage` → `/signup/pending-activation`
  - `ConsoleAuthPage` → `/console/auth`
  - `ConsoleServiceAccountsPage` → `/console/service-accounts`
  - `ConsoleCapabilityCatalogPage` → _(no top-level console route in `apps/web-console/src/router.tsx`; rendered as an embedded sub-view via props — see Open question Q-IAM-02)_
  - `ConsolePrivilegeDomainPage` → _(no top-level console route; embedded sub-view receiving `workspaceId`, `memberId` via props — see Q-IAM-04)_
  - `ConsolePrivilegeDomainAuditPage` → _(no top-level console route; embedded sub-view — see Q-IAM-04)_
  - `ConsoleScopeEnforcementPage` → _(no top-level console route; embedded sub-view receiving `isSuperadmin` via props — see Q-IAM-04)_
- **Internal contracts**:
  - `services/internal-contracts/src/authorization-model.json` — the canonical security context, authorization-decision shape, ownership semantics, role/scope matrix, and context-propagation targets.
  - `services/internal-contracts/src/privilege-domain-assignment.schema.json`
  - `services/internal-contracts/src/privilege-domain-denial.schema.json`
  - `services/internal-contracts/src/scope-enforcement-denial-event.json`
  - `services/internal-contracts/src/scope-enforcement-denial-query-response.json`
  - The `iam_admin_request`, `iam_admin_result`, `iam_lifecycle_event`, and `audit_record` contracts exposed by `services/internal-contracts/src/index.mjs` and consumed by `apps/control-plane/src/iam-admin.mjs`, `apps/control-plane/src/iam-governance.mjs`, `apps/control-plane/src/authorization-model.mjs`, and `apps/control-plane/src/console-auth.mjs`.
- **Kafka topics emitted**:
  - IAM lifecycle events declared in `apps/control-plane/src/iam-governance.mjs`: `iam.user.login.succeeded`, `iam.user.logout.completed`, `iam.user.signup.requested`, `iam.user.activation.completed`, `iam.user.status.changed`, `iam.user.credentials.reset`, `iam.invitation.created`, `iam.invitation.accepted`, `iam.invitation.revoked`, `iam.tenant.access.suspended`, `iam.tenant.access.reactivated`, `iam.service_account.blocked`, `iam.service_account.reactivated`, `iam.client.revoked`.
  - Scope-enforcement denial events as defined by `services/internal-contracts/src/scope-enforcement-denial-event.json`.
- **Kafka topics consumed**:
  - _None directly — the audit pipeline owned by `observability-and-audit` is the consumer of the IAM lifecycle topics above._
- **PostgreSQL tables owned**:
  - `privilege_domain_assignments`, `privilege_domain_assignment_history`, `privilege_domain_denials`, and the `workspace_structural_admin_count` view (created by `services/provisioning-orchestrator/src/migrations/094-admin-data-privilege-separation.sql`).
  - `scope_enforcement_denials`, `endpoint_scope_requirements` (created by `services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql`).
- **Owned services**:
  - `services/keycloak-config/` — currently contains only the `scopes/backup-*.yaml` files; see Open question Q-IAM-01. The substantive Keycloak adapter logic lives in `services/adapters/src/keycloak-admin.mjs` and is invoked by `services/provisioning-orchestrator` rather than by IAM directly.

## Behaviour

### REQ-IAM-01 — Console session lifecycle

**Description.** Console operators authenticate with username/password and receive an SPA session envelope with access and refresh tokens. The same session can be refreshed without replaying credentials and can be explicitly terminated.

**Acceptance criteria.**

- `POST /v1/auth/login-sessions` accepts username/password and returns the session envelope (`sessionId`, `tokenSet`, `principal`, `sessionPolicy`).
- `POST /v1/auth/login-sessions/{sessionId}/refresh` rotates the access token set from a refresh token without re-authenticating.
- `DELETE /v1/auth/login-sessions/{sessionId}` invalidates the session and revokes its refresh lifecycle.
- The console refuses to remain on `/login` once a valid session exists in storage and redirects to `/console/overview` (or to the remembered protected route).

**Trace.**
`apps/control-plane/openapi/families/auth.openapi.json`, `apps/control-plane/src/console-auth.mjs`, `apps/web-console/src/pages/LoginPage.tsx`, `apps/web-console/src/pages/LoginPage.test.tsx`, `docs/tasks/us-iam-03.md`, `docs/adr/0009-keycloak-platform-and-tenant-iam.md`.

### REQ-IAM-02 — Self-service signup with policy gating and superadmin activation

**Description.** Self-service signup is governed by an effective policy resolved across global, environment, and plan overrides. When the policy disables signup, the public surfaces hide the call to action and refuse to create registrations. When activation is approval-required, the registration enters `pending_activation` until a superadmin decides.

**Acceptance criteria.**

- `GET /v1/auth/signups/policy` returns the effective `effectiveMode` (`auto_activate`, `approval_required`, `disabled`) plus the underlying global, environment, and plan overrides.
- `POST /v1/auth/signups` creates a registration only when policy allows; the response carries `activationMode` and `state` so the client can route to login or to pending-activation.
- `POST /v1/auth/signups/{registrationId}/activation-decisions` is restricted to platform superadmins and approves or rejects a `pending_activation` registration.
- When `effectiveMode` is `disabled`, both `LoginPage` and `SignupPage` hide the signup CTA and surface the policy reason verbatim.

**Trace.**
`apps/control-plane/openapi/families/auth.openapi.json`, `apps/web-console/src/pages/SignupPage.tsx`, `apps/web-console/src/pages/SignupPage.test.tsx`, `apps/web-console/src/pages/PendingActivationPage.tsx`, `apps/web-console/src/pages/PendingActivationPage.test.tsx`, `docs/tasks/us-iam-03.md`.

### REQ-IAM-03 — Password recovery without account-existence leak

**Description.** Password recovery is initiated by the operator and confirmed via a single-use token. The initiation response must not disclose whether the account exists.

**Acceptance criteria.**

- `POST /v1/auth/password-recovery-requests` always returns a generic accepted response shape, regardless of whether the username/email is recognized.
- `POST /v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations` validates the token, replaces the credential, and returns a status-view (`statusViewId`) that the console renders.
- `GET /v1/auth/status-views/{statusViewId}` resolves the canonical title, message, and allowed actions for each console auth edge state (`login`, `signup`, `pending_activation`, `account_suspended`, `credentials_expired`, `password_recovery`).

**Trace.**
`apps/control-plane/openapi/families/auth.openapi.json`, `apps/control-plane/src/console-auth.mjs`, `docs/tasks/us-iam-03.md`.

### REQ-IAM-04 — Normalized IAM administration over Keycloak

**Description.** Platform and tenant operators administer Keycloak realms, clients, roles, client scopes, and users through normalized BaaS contracts; no caller ever sees a raw Keycloak provider payload.

**Acceptance criteria.**

- Each `/v1/iam/realms[/...]` operation (`list`, `create`, `get`, `update`, `delete`, `set-status`) accepts and returns the normalized `iam_admin_request` / `iam_admin_result` contract shape and persists changes through the `keycloak` identity adapter port declared in `services/internal-contracts/src/internal-service-map.json`.
- Realm-scoped resources — clients, roles, scopes, users — expose the same lifecycle verbs and surface validation rather than provider-native error payloads.
- `POST /v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets` rotates a managed user's credential or required actions without exposing provider-native payloads.
- IAM administrative requests fail closed when the requested Keycloak version is not in the supported compatibility matrix exported by `services/adapters/src/keycloak-admin.mjs`.

**Trace.**
`apps/control-plane/openapi/families/iam.openapi.json`, `apps/control-plane/src/iam-admin.mjs`, `services/adapters/src/keycloak-admin.mjs`, `docs/tasks/us-iam-02.md`, `docs/adr/0009-keycloak-platform-and-tenant-iam.md`.

### REQ-IAM-05 — Contextual authorization decision

**Description.** Every sensitive request must resolve one normalized security context, and every enforcement surface must consume the same `authorization_decision` contract. Resolution is deny-by-default and verifies tenant binding before workspace binding.

**Acceptance criteria.**

- `POST /v1/auth/access-checks` accepts an `AccessCheckRequest` (`tenantId`, `workspaceId?`, `resourceType`, `resourceId`, `action`, optional `delegationId`) and returns an `AccessCheckDecision` with `decision` ∈ {`allow`, `deny`}, `decisionId`, `reason`, `correlationId`, `matchedPolicies`, `context`, optional `ownership`, optional `quota`.
- `resourceType` is restricted to the canonical set declared in `auth.openapi.json` (`tenant`, `workspace`, `database`, `bucket`, `topic`, `function`, `app`, `service_account`, `function_audit`, `function_audit_coverage`).
- A request whose tenant binding fails returns `decision: "deny"` regardless of workspace binding.
- Delegation never expands scopes or roles beyond the original chain (delegation is limited to declared delegable actions per `authorization-model.json`).

**Trace.**
`apps/control-plane/openapi/families/auth.openapi.json`, `apps/control-plane/src/authorization-model.mjs`, `services/internal-contracts/src/authorization-model.json`, `docs/tasks/us-arc-03.md`, `docs/adr/0005-contextual-authorization-model.md`.

### REQ-IAM-06 — Privilege-domain separation

**Description.** Every platform permission is classified into exactly one of two top-level privilege domains: `structural_admin` or `data_access`. A workspace member can hold either, both, or neither. Domain claims are carried in the JWT (`privilege_domain`) and in the `api_keys.privilege_domain` column, and are enforced before requests reach backend services.

**Acceptance criteria.**

- `privilege_domain_assignments` records exactly one row per `(tenant_id, workspace_id, member_id)` with two booleans (`structural_admin`, `data_access`) and is updatable with `assigned_by` and an immutable history mirror in `privilege_domain_assignment_history`.
- The console privilege-domain editor refuses to revoke `structural_admin` from the last structural admin of a workspace; the API surface returns the error code `LAST_STRUCTURAL_ADMIN` and the editor renders the audit-driven confirmation dialog before any revocation.
- A request whose credential domain does not satisfy the route's required domain is rejected with an audited `privilege_domain_denials` row keyed by `correlation_id`.
- The audit lens (`ConsolePrivilegeDomainAuditPage`) can filter denials by `requiredDomain`, `tenantId`, `workspaceId`, `actorId`, and time range, exports the filtered set as CSV, and shows a 24h badge of denial count.

**Trace.**
`services/provisioning-orchestrator/src/migrations/094-admin-data-privilege-separation.sql`, `services/internal-contracts/src/privilege-domain-assignment.schema.json`, `services/internal-contracts/src/privilege-domain-denial.schema.json`, `apps/web-console/src/services/privilege-domain-api.ts`, `apps/web-console/src/pages/ConsolePrivilegeDomainPage.test.tsx`, `apps/web-console/src/pages/ConsolePrivilegeDomainAuditPage.test.tsx`, `docs/adr/adr-094-privilege-domain-separation.md`.

### REQ-IAM-07 — Scope-enforcement denial recording and audit lens

**Description.** Out-of-scope token and membership usage is blocked at the gateway in the `access` phase before the request reaches backend services. Every denial is persisted with the full evaluation context for later audit.

**Acceptance criteria.**

- `endpoint_scope_requirements` declares, per `(http_method, path_pattern)`, the `required_scopes`, optional `required_entitlements`, and whether the endpoint is `workspace_scoped`. Endpoints absent from this table fail closed and emit a denial of type `CONFIG_ERROR`.
- `scope_enforcement_denials` records every denial with `denial_type` ∈ {`SCOPE_INSUFFICIENT`, `PLAN_ENTITLEMENT_DENIED`, `WORKSPACE_SCOPE_MISMATCH`, `CONFIG_ERROR`}, the missing/required/presented scopes, the current plan, the actor, and the correlation id.
- `ConsoleScopeEnforcementPage` queries the denial surface, refreshes the result set on demand and on date-range change, and only shows the `CONFIG_ERROR` banner when the operator has the `superadmin` platform role.
- Plan entitlement changes are reflected in enforcement within the cache TTL declared by ADR 093 (≤ 30 s).

**Trace.**
`services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql`, `services/internal-contracts/src/scope-enforcement-denial-event.json`, `services/internal-contracts/src/scope-enforcement-denial-query-response.json`, `apps/web-console/src/lib/console-scope-enforcement.ts`, `apps/web-console/src/pages/ConsoleScopeEnforcementPage.test.tsx`, `docs/adr/093-scope-enforcement-blocking.md`.

### REQ-IAM-08 — IAM lifecycle traceability

**Description.** Every IAM lifecycle change (login, signup, activation, status change, credential reset, invitation, tenant access, service-account state, client revocation) emits an audit event and surfaces in the per-tenant and per-workspace activity feeds with rich actor and origin context.

**Acceptance criteria.**

- `GET /v1/iam/tenants/{tenantId}/activity` and `GET /v1/iam/workspaces/{workspaceId}/activity` return the IAM lifecycle activity for the requested scope with actor, target, request IP, user agent, and correlation id.
- The set of emitted lifecycle event types matches `IAM_LIFECYCLE_EVENT_TYPES` in `apps/control-plane/src/iam-governance.mjs`.
- Tenant suspension overrides user and service-account access until the tenant is reactivated; user disablement only blocks the human identity (per `evaluateTenantIamAccess` in `iam-governance.mjs`).
- Each lifecycle event carries the audit-context fields `actor_id`, `actor_type`, `origin_surface`, `request_ip`, `user_agent`, `target_tenant_id`, `target_workspace_id` (`IAM_ADMIN_AUDIT_CONTEXT_FIELDS`).

**Trace.**
`apps/control-plane/openapi/families/iam.openapi.json`, `apps/control-plane/src/iam-governance.mjs`, `docs/tasks/us-iam-06.md`, `docs/adr/0009-keycloak-platform-and-tenant-iam.md`.

## Cross-capability dependencies

- `workspace-management` — service-account routes (`/v1/workspaces/{id}/service-accounts*`) and external-application routes (`/v1/workspaces/{id}/applications*`, including federation providers) live in the workspaces family. `ConsoleServiceAccountsPage` and `ConsoleAuthPage` consume those routes as cross-capability dependencies; IAM owns only the page mapping and the underlying identity semantics.
- `tenant-lifecycle` — IAM activity is scoped to tenants (`/v1/iam/tenants/{tenantId}/activity`); tenant suspension/reactivation events drive the IAM access-evaluation behaviour described in REQ-IAM-08.
- `observability-and-audit` — every IAM lifecycle event and every scope/privilege denial is consumed by the audit pipeline owned by OBS; IAM only emits, it does not store the long-term audit trail.
- `gateway-and-public-surface` — the APISIX `access`-phase Lua plugin enforces scopes and privilege domains and is owned by GW; IAM provides the contract (`endpoint_scope_requirements`, `authorization-model.json`) and the denial schema.
- `secret-management` — Keycloak admin credentials, JWT signing keys, and client secrets are distributed via External Secrets Operator + Vault; IAM does not store secrets directly.
- `quota-and-billing` — plan entitlements (`required_entitlements`, `current_plan_id`) are evaluated during scope enforcement; the plan/quota model itself lives in QTA.

## Out of scope

- Tenant-scoped data access and PostgreSQL row-level security (`data-services`).
- Service-account routes themselves and external-application routes themselves (`workspace-management`).
- The audit pipeline, audit storage, audit query/export/correlation surfaces (`observability-and-audit`).
- Plan and quota policy CRUD (`quota-and-billing`).
- Secret distribution and rotation flows (`secret-management`).
- Kafka topic creation, ACLs, and websocket session storage (`realtime-and-events`).
- Workspace capability catalog (postgres-database / mongo-collection enablement) — see Q-IAM-02.

## Open questions

- **Q-IAM-01.** `services/keycloak-config/` is asserted as IAM-owned by the catalog, but its only contents today are `scopes/backup-*.yaml` (four files declaring backup-related Keycloak scopes). The substantive Keycloak admin logic lives in `services/adapters/src/keycloak-admin.mjs`, which the catalog assigns to `data-services`. Decide whether (a) `services/keycloak-config/` is the future home for Keycloak realm/client config and the backup yaml is an early seed, or (b) the directory is misnamed and IAM should own a different path. The catalog mapping should be updated either way.
- **Q-IAM-02.** `ConsoleCapabilityCatalogPage` is mapped to IAM by the catalog, but its test (`ConsoleCapabilityCatalogPage.test.tsx`) and its supporting contracts (`workspace-capability-catalog-response.json`, `workspace-capability-catalog-accessed-event.json`) describe a *workspace*-capability catalog (postgres-database / mongo-collection enablement, examples, enablement guides). Recommend reassigning this page to `workspace-management` and updating the catalog. If left in IAM, the spec would have to invent a behaviour the code does not implement.
- **Q-IAM-03.** `ConsolePrivilegeDomainPage`, `ConsolePrivilegeDomainAuditPage`, and `ConsoleScopeEnforcementPage` call `/api/workspaces/{ws}/members/{mid}/privilege-domains`, `/api/security/privilege-domains/denials`, and `/api/security/scope-enforcement/denials`. None of these are registered in any `/v1/*` OpenAPI family. Decide whether to (a) promote them to `/v1/iam/...` (new operations in `iam.openapi.json`) or (b) document them as an internal-only `/api/security/*` surface served behind APISIX. Today the public OpenAPI does not describe them.
- **Q-IAM-04.** `ConsolePrivilegeDomainPage`, `ConsolePrivilegeDomainAuditPage`, `ConsoleScopeEnforcementPage`, and `ConsoleCapabilityCatalogPage` exist in `apps/web-console/src/pages/` but are *not* mounted in `apps/web-console/src/router.tsx`. They are rendered as embedded sub-views with props (`workspaceId`, `memberId`, `isSuperadmin`, `fetcher`). Decide whether each should gain a top-level console route (e.g. `/console/workspaces/:wsId/members/:memberId/privilege-domain`) or whether the catalog should record them as "embedded view, no route".
- **Q-IAM-05.** No PostgreSQL migration was found that creates tables for console login sessions, signups, or password recovery requests. The `/v1/auth/*` endpoints are documented and the contracts are defined, but the persistence layer for these resources is not present in `services/provisioning-orchestrator/src/migrations/`. Confirm where this state is stored (Keycloak-side vs platform DB) before declaring tables as IAM-owned in this spec.
