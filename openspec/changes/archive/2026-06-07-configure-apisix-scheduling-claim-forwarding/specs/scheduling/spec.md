## MODIFIED Requirements

### Requirement: Scheduling identity is derived exclusively from verified JWT claims

The system SHALL derive `tenantId`, `workspaceId`, and `actorId` for all scheduling operations exclusively from the trusted identity headers that the API gateway injects from the verified token — `X-Tenant-Id` (claim `tenant_id`), `X-Workspace-Id` (claim `workspace_id`), `X-Auth-Subject` (claim `sub`), and `X-Actor-Roles` (claim `realm_access.roles`) — read by the action as the lowercase keys `x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles` on `params.__ow_headers`. The system SHALL NOT read identity from `params.tenantId`, `params.workspaceId`, `params.actorId`, the request body, or the query string.

#### Scenario: Request with body tenantId but no trusted identity headers is rejected

- **WHEN** a caller sends a scheduling request supplying `tenantId` and `workspaceId` in the request body but with no trusted identity headers
- **THEN** the system returns HTTP 401 / `UNAUTHENTICATED` before any scheduling operation is executed
- **AND** the body-supplied fields are never used as identity

#### Scenario: Trusted identity headers are used for identity, ignoring the request body

- **WHEN** a caller's request carries a trusted `X-Tenant-Id` header for tenant A and the request body contains a conflicting `tenantId` for tenant B
- **THEN** the system derives the identity from the trusted headers (tenant A) and ignores the body value

### Requirement: Absent or incomplete JWT claims cause hard rejection

The system SHALL return HTTP 401 / `UNAUTHENTICATED` when the trusted `X-Tenant-Id` or `X-Workspace-Id` identity header (carrying the verified `tenant_id` / `workspace_id` claim) is absent or empty, before executing any scheduling read or write operation.

#### Scenario: Missing X-Tenant-Id header is rejected

- **WHEN** a scheduling request arrives without a trusted `X-Tenant-Id` identity header
- **THEN** the system returns HTTP 401 before any DB query is executed

#### Scenario: Missing X-Workspace-Id header is rejected

- **WHEN** a scheduling request arrives without a trusted `X-Workspace-Id` identity header
- **THEN** the system returns HTTP 401 before any DB query is executed

## ADDED Requirements

### Requirement: API gateway injects verified token claims as trusted identity headers

The system SHALL configure the scheduling route (`deploy/apisix/routes/scheduling.yaml`) so that, after the `openid-connect` plugin validates the bearer token, a `proxy-rewrite` plugin injects the verified token claims as the trusted identity headers `X-Auth-Subject` (`$jwt_claim_sub`), `X-Tenant-Id` (`$jwt_claim_tenant_id`), `X-Workspace-Id` (`$jwt_claim_workspace_id`), and `X-Actor-Roles` (`$jwt_claim_realm_access_roles`), so the upstream scheduling action receives identity from a trusted source on every request.

#### Scenario: Authenticated request reaches the action with trusted identity headers

- **WHEN** a caller sends `GET /v1/scheduling/jobs` with a valid bearer token whose claims include `tenant_id` and `workspace_id`
- **THEN** the gateway validates the token and injects `X-Tenant-Id` and `X-Workspace-Id` (and `X-Auth-Subject`, `X-Actor-Roles`) into the upstream request
- **AND** the scheduling action derives the identity from those headers and returns HTTP 200 with the caller's scoped job list

#### Scenario: Authenticated request with a valid token creates a job scoped to the token tenant

- **WHEN** a caller sends `POST /v1/scheduling/jobs` with a valid bearer token and a valid job body
- **THEN** the gateway injects the verified identity headers
- **AND** the scheduling action creates the job scoped to the header-derived `tenantId`/`workspaceId` and returns HTTP 201

### Requirement: Client-supplied identity headers are rejected to prevent spoofing

The system SHALL ensure the scheduling route rejects any request that itself carries the identity headers `X-Auth-Subject`, `X-Tenant-Id`, `X-Workspace-Id`, or `X-Actor-Roles` (via a `request-validation` `header_schema` constraining each to `maxLength: 0`), so that only gateway-injected, token-derived values can ever populate them.

#### Scenario: Request carrying a client-set X-Tenant-Id header is rejected

- **WHEN** a caller sends a scheduling request that includes a client-supplied `X-Tenant-Id` header
- **THEN** the gateway rejects the request (HTTP 400) before the scheduling action is invoked
- **AND** the client-supplied header value is never propagated as identity
