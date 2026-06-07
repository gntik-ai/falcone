## ADDED Requirements

### Requirement: API gateway injects verified JWT claims into the scheduling action as params.jwt

The system SHALL configure the API gateway `openid-connect` plugin on the scheduling route (`deploy/apisix/routes/scheduling.yaml`) to decode the validated bearer token and forward the verified claims — including `tenantId`, `workspaceId`, `sub`, and `roles` — to the upstream scheduling action as the `params.jwt` object, so that `parseIdentity` (`services/scheduling-engine/actions/scheduling-management.mjs:15-25`) can derive a scoped identity from a trusted source for every scheduling request.

#### Scenario: Authenticated request with valid bearer token reaches the action with populated params.jwt

- **WHEN** a caller sends a request to `GET /v1/scheduling/jobs` with a valid bearer token containing `tenantId` and `workspaceId` claims
- **THEN** the API gateway validates the token and injects the verified claims as `params.jwt` into the upstream action invocation
- **AND** `parseIdentity` successfully derives `tenantId`, `workspaceId`, and `actorId` from `params.jwt`
- **AND** the scheduling action returns HTTP 200 with the caller's scoped job list

#### Scenario: Authenticated request with valid bearer token creates a job

- **WHEN** a caller sends a `POST /v1/scheduling/jobs` request with a valid bearer token and a valid job body
- **THEN** the API gateway injects the verified claims as `params.jwt`
- **AND** the scheduling action creates the job scoped to the token-derived `tenantId` and `workspaceId`
- **AND** returns HTTP 201

### Requirement: Requests without a valid bearer token are rejected at the gateway before reaching the scheduling action

The system SHALL ensure that the API gateway rejects any request to `/v1/scheduling/*` that does not carry a valid bearer token with HTTP 401 at the gateway layer, so that the scheduling action is never invoked with an absent or forged identity.

#### Scenario: Request without bearer token is rejected at the gateway

- **WHEN** a caller sends a request to `POST /v1/scheduling/jobs` without an `Authorization` header
- **THEN** the API gateway returns HTTP 401
- **AND** the scheduling action is not invoked

#### Scenario: Request with an invalid or expired bearer token is rejected at the gateway

- **WHEN** a caller sends a request to `/v1/scheduling/jobs` with a malformed or expired bearer token
- **THEN** the API gateway returns HTTP 401
- **AND** the scheduling action is not invoked

### Requirement: Gateway injects only verified claims; caller-supplied body or query fields are not used as identity

The system SHALL ensure that the claims forwarded to the scheduling action as `params.jwt` originate exclusively from the gateway-verified token, and that no caller-supplied request body field, query parameter, or header value is used to populate `params.jwt.tenantId`, `params.jwt.workspaceId`, or `params.jwt.sub`.

#### Scenario: Caller-supplied tenantId in the request body does not substitute for a missing token

- **WHEN** a caller sends a scheduling request without a bearer token but includes `tenantId` and `workspaceId` in the request body
- **THEN** the API gateway returns HTTP 401 before the action is invoked
- **AND** the body-supplied identity fields are never used to populate `params.jwt`

#### Scenario: Token-derived tenantId takes precedence over any body-supplied value

- **WHEN** a caller sends a request with a valid bearer token containing `tenantId=A` and also supplies `tenantId=B` in the request body
- **THEN** `params.jwt.tenantId` equals `A` (the gateway-verified claim)
- **AND** the scheduling action uses `A` for all tenant-scoped operations
