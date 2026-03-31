# Feature Specification: Scope Enforcement & Out-of-Scope Blocking

**Feature Branch**: `093-scope-enforcement-blocking`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: US-SEC-02-T03 — Registrar y bloquear intentos de uso fuera del scope del token o de la membresía.  
**Backlog Traceability**: EP-18 / US-SEC-02 / US-SEC-02-T03  
**Requisitos funcionales cubiertos**: RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

## User Scenarios & Testing

### User Story 1 - Block API Calls with Insufficient Token Scope (Priority: P1)

A tenant developer issues an API request using a token whose scopes do not cover the requested resource or action. The platform evaluates the token scopes against the resource requirements and rejects the request before any business logic runs, returning a clear error that identifies the missing scope.

**Why this priority**: This is the core security gate. Without it, tokens could be used to access resources beyond their granted permissions, violating the principle of least privilege.

**Independent Test**: Issue an API call with a valid token that lacks the required scope for the target endpoint and verify the request is rejected with the correct error response.

**Acceptance Scenarios**:

1. **Given** a valid token with scopes `["storage:read"]`, **When** the bearer attempts a `POST /functions/deploy` (requiring `functions:deploy`), **Then** the request is rejected with HTTP 403, an error body indicating `SCOPE_INSUFFICIENT` and the missing scope name, and no side effects occur on the target resource.
2. **Given** a valid token with scopes `["db:read", "db:write"]`, **When** the bearer accesses `GET /db/collections` (requiring `db:read`), **Then** the request succeeds normally.
3. **Given** an expired or revoked token, **When** any request is made, **Then** the request is rejected with HTTP 401 (authentication failure) before scope evaluation takes place.

---

### User Story 2 - Block Operations Outside Membership Plan Entitlements (Priority: P1)

A tenant whose membership plan does not include a certain capability (e.g., real-time subscriptions, advanced analytics) attempts to use that capability. The platform checks the tenant's active plan entitlements and rejects the request with a clear explanation of the plan limitation.

**Why this priority**: Membership-based enforcement prevents revenue leakage and ensures fair usage across plan tiers. It is a business-critical control alongside token scope.

**Independent Test**: Configure a tenant on a plan that excludes real-time subscriptions, then attempt to create a real-time subscription endpoint and verify the request is rejected with a plan entitlement error.

**Acceptance Scenarios**:

1. **Given** a tenant on the "Starter" plan (which excludes `realtime:subscribe`), **When** the tenant calls `POST /realtime/subscriptions`, **Then** the system returns HTTP 403 with error code `PLAN_ENTITLEMENT_DENIED` and a message naming the missing entitlement and the current plan.
2. **Given** a tenant on the "Pro" plan (which includes `realtime:subscribe`), **When** the tenant calls `POST /realtime/subscriptions`, **Then** the request proceeds normally.
3. **Given** a tenant upgrades from "Starter" to "Pro", **When** the tenant retries the previously denied capability, **Then** the request is accepted without delay once the plan change is active.

---

### User Story 3 - Record Audit Trail for Every Denied Request (Priority: P1)

Every time a request is denied due to scope insufficiency or plan entitlement violation, the platform records a structured audit event containing the actor identity, the denied action, the reason for denial, and a timestamp. Security operators and tenant owners can later query these events.

**Why this priority**: Without an audit trail, the organization cannot detect abuse patterns, investigate incidents, or demonstrate compliance. Logging is mandatory for the security value of the blocking itself.

**Independent Test**: Trigger a scope-denied and a plan-denied request, then query the audit log and verify both events appear with the correct metadata.

**Acceptance Scenarios**:

1. **Given** a scope-denied request occurs, **When** a security operator queries the audit log filtered by `event_type = SCOPE_INSUFFICIENT` and the relevant tenant and time range, **Then** the event is present with fields: actor identity, requested resource, required scope, presented scopes, timestamp, and source IP.
2. **Given** a plan-denied request occurs, **When** the tenant owner views their audit events, **Then** the event is present with fields: actor identity, attempted capability, required entitlement, current plan, timestamp.
3. **Given** 100 denied requests occur within one minute for the same tenant, **When** the audit log is queried, **Then** all 100 events are recorded without loss or deduplication (each event is individually traceable).

---

### User Story 4 - Superadmin Visibility of Cross-Tenant Denial Patterns (Priority: P2)

A superadmin or platform security operator needs a cross-tenant view of scope and plan enforcement events to identify attack patterns, misconfigured tokens, or tenants repeatedly hitting plan limits.

**Why this priority**: Cross-tenant visibility enables proactive security response but depends on the per-tenant audit trail (Story 3) being in place first.

**Independent Test**: Generate denial events across two or more tenants, then as superadmin query the platform-wide audit stream and verify events from all tenants are visible and filterable.

**Acceptance Scenarios**:

1. **Given** denial events exist for tenants A, B, and C, **When** a superadmin queries denials for the last 24 hours without tenant filter, **Then** results include events from all three tenants, each annotated with the originating tenant identifier.
2. **Given** a burst of 50 scope-denied events from a single tenant in 5 minutes, **When** the superadmin views the audit stream, **Then** the events are surfaced with enough metadata (actor, IP, scope) to distinguish between misconfiguration and a potential attack.

---

### User Story 5 - Workspace-Level Scope Restriction (Priority: P2)

Within a tenant, workspace-level tokens or memberships can further restrict the effective scopes. A token valid for workspace A cannot operate on workspace B's resources, even if the underlying scopes would otherwise allow it.

**Why this priority**: Workspace isolation within a tenant adds a second dimension of scope enforcement, critical for multi-team tenants, but is an additive refinement over the base token scope check.

**Independent Test**: Create two workspaces under one tenant, issue a token scoped to workspace A, and attempt to read a resource in workspace B; verify the request is denied.

**Acceptance Scenarios**:

1. **Given** token T is scoped to workspace A with `db:read`, **When** T requests `GET /workspaces/B/db/collections`, **Then** the request is denied with HTTP 403 and error code `WORKSPACE_SCOPE_MISMATCH`.
2. **Given** token T is scoped to workspace A with `db:read`, **When** T requests `GET /workspaces/A/db/collections`, **Then** the request succeeds.

---

### Edge Cases

- **Token with an empty scope set**: Must be denied on every resource access with `SCOPE_INSUFFICIENT` (a token with no scopes grants no capabilities).
- **Concurrent plan change during request processing**: If a tenant's plan is downgraded while a request is in flight, the system must use the plan state at the moment of evaluation (no stale cache beyond acceptable TTL).
- **Unknown or unrecognized scope in the token**: Unrecognized scopes are silently ignored during matching; access is determined only by recognized scopes present.
- **API endpoint with no scope requirement defined**: Misconfigured endpoints with no scope requirement must default to deny (fail-closed), and the incident must be logged as a configuration error for platform operators.
- **Service-to-service internal calls**: Internal service calls that bypass the gateway must still pass through scope evaluation when carrying a user/tenant token context.
- **Rate of audit event production under attack**: The audit system must sustain high-throughput writes without back-pressure causing request latency to spike; if audit ingestion is saturated, enforcement (deny) must still proceed and audit events must be buffered rather than dropped.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST evaluate token scopes against the required scopes of the target resource/action before executing any business logic.
- **FR-002**: The system MUST reject requests where the token's scopes do not satisfy the resource's required scopes, returning HTTP 403 with error code `SCOPE_INSUFFICIENT` and the list of missing scopes.
- **FR-003**: The system MUST evaluate the requesting tenant's active plan entitlements before permitting access to plan-gated capabilities.
- **FR-004**: The system MUST reject requests for capabilities not included in the tenant's current plan, returning HTTP 403 with error code `PLAN_ENTITLEMENT_DENIED`, the missing entitlement name, and the tenant's current plan identifier.
- **FR-005**: The system MUST enforce workspace-level scope isolation: a token scoped to workspace A MUST NOT be usable against resources in workspace B, even if the underlying scopes match.
- **FR-006**: The system MUST record a structured audit event for every denied request (scope or plan), containing: actor identity, requested resource/action, denial reason, required vs. presented scopes or entitlements, tenant identifier, workspace identifier (if applicable), source IP, and UTC timestamp.
- **FR-007**: The system MUST publish audit events for denied requests to the event backbone (Kafka) for downstream consumption by security monitoring and alerting systems.
- **FR-008**: Superadmins MUST be able to query denial audit events across all tenants, with filtering by tenant, time range, denial type, and actor.
- **FR-009**: Tenant owners MUST be able to query denial audit events scoped to their own tenant, with filtering by workspace, time range, denial type, and actor.
- **FR-010**: The system MUST default to deny (fail-closed) for any endpoint that lacks a scope requirement definition, and MUST log this as a configuration error.
- **FR-011**: Scope evaluation MUST occur after authentication but before authorization business logic, ensuring unauthenticated requests are rejected with HTTP 401 before scope checks apply.
- **FR-012**: Plan entitlement changes (upgrades/downgrades) MUST take effect within a bounded propagation window and the system MUST NOT use stale plan data beyond that window.

### Key Entities

- **Token Scope Set**: The set of granular permissions (e.g., `db:read`, `functions:deploy`) embedded in or associated with an access token. Determines what actions the bearer is allowed to perform.
- **Plan Entitlement**: A capability granted or withheld by the tenant's membership plan (e.g., `realtime:subscribe`, `analytics:advanced`). Determines which product features are accessible to the tenant.
- **Scope Enforcement Event**: An audit record generated when a request is denied due to scope insufficiency, plan entitlement violation, or workspace mismatch. Contains all contextual metadata for investigation.
- **Endpoint Scope Requirement**: The declared set of scopes that a given API endpoint requires. Each protected endpoint must have this declaration; absence triggers fail-closed behavior.
- **Workspace Scope Binding**: The association between a token and the specific workspace(s) it is authorized to operate within, adding a spatial dimension to scope enforcement.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of API requests carrying a token with insufficient scopes are rejected before any business logic executes.
- **SC-002**: 100% of requests for plan-gated capabilities by tenants without the required entitlement are rejected with a clear, actionable error message.
- **SC-003**: Every denied request (scope or plan) produces a queryable audit event within 5 seconds of the denial.
- **SC-004**: Superadmins can retrieve cross-tenant denial reports filtered by tenant, time, and denial type, returning results within 10 seconds for queries spanning up to 30 days.
- **SC-005**: Zero data leakage: no business data is returned or mutated as a result of a request that should have been denied by scope or plan enforcement.
- **SC-006**: Enforcement operates correctly under concurrent plan changes — a downgraded tenant is denied within the defined propagation window, and an upgraded tenant is granted access once the change propagates.
- **SC-007**: Workspace-scoped tokens cannot access resources in any workspace other than the one(s) they are bound to, verified across all resource types.

## Assumptions

- Token scopes follow a `domain:action` naming convention (e.g., `db:read`, `functions:deploy`, `storage:write`) consistent with existing platform token issuance.
- Plan entitlements are maintained as part of the tenant's subscription record and are queryable by the enforcement layer.
- The API gateway (APISIX) participates in scope evaluation, either by performing the check directly via plugin or by forwarding enriched token metadata to downstream services that perform the check.
- US-SEC-02-T01 (secure secret storage) and US-SEC-02-T02 (secret rotation without redeployment) are implemented or in progress, providing the foundational credential management that scope enforcement builds upon.
- Existing Kafka infrastructure supports the additional audit event topics required by this feature.
- Workspace isolation semantics are already defined at the platform level; this feature enforces them at the scope/token layer rather than redefining them.

## Scope Boundaries

### In Scope

- Token scope evaluation and enforcement at the API request level.
- Plan entitlement evaluation and enforcement at the API request level.
- Workspace-level scope isolation.
- Audit logging of all denied requests (scope, plan, workspace mismatch).
- Superadmin and tenant-owner query access to denial audit events.
- Fail-closed default for unconfigured endpoints.

### Out of Scope

- Token issuance, renewal, or revocation (handled by IAM/Keycloak — US-SEC-02-T01).
- Secret rotation mechanics (US-SEC-02-T02).
- Structural admin vs. data access permission separation (US-SEC-02-T04).
- Function deployment vs. execution permission separation (US-SEC-02-T05).
- Hardening and penetration test suites (US-SEC-02-T06).
- Plan management UI or billing integration (separate product domain).
- Definition of which scopes each endpoint requires (assumed to be a governance/configuration activity that this feature enforces, not defines).
