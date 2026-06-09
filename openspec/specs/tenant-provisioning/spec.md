# tenant-provisioning Specification

## Purpose
TBD - created by archiving. Update Purpose after archive.
## Requirements
### Requirement: Verified token identity for tenant-config actions

The system SHALL reject any request to a `tenant-config-*` action whose Bearer token cannot be cryptographically verified (signature, issuer, audience, and expiry checks all passing) before any role or scope claim is evaluated.

#### Scenario: Unsigned forged token with superadmin role is rejected

- **WHEN** a caller submits a request to `tenant-config-migrate` with a Bearer token whose payload claims `realm_access.roles: ["superadmin"]` and `scope: "platform:admin:config:export"` but whose signature is absent or invalid
- **THEN** the action MUST return HTTP 403 and MUST NOT grant `actor_type = 'superadmin'` or process the request body

#### Scenario: Unsigned forged token with sre role is rejected

- **WHEN** a caller submits a request to `tenant-config-validate` with an unsigned token payload claiming `realm_access.roles: ["sre"]`
- **THEN** the action MUST return HTTP 403 and MUST NOT assign `actor_type = 'sre'`

#### Scenario: Unsigned forged token with service_account scope is rejected

- **WHEN** a caller submits a request to `tenant-config-export` with an unsigned token claiming `scope: "platform:admin:config:export"` and `azp: "some-client"`
- **THEN** the action MUST return HTTP 403 and MUST NOT assign `actor_type = 'service_account'`

### Requirement: Legitimate verified tokens continue to be accepted

The system SHALL accept requests to `tenant-config-*` actions that carry a properly JWKS-verified token (or arrive with trusted gateway headers) bearing the `platform:admin:config:export` scope or recognised platform role.

#### Scenario: Valid JWKS-signed token with correct role is accepted

- **WHEN** a caller presents a valid, JWKS-signed Bearer token whose `realm_access.roles` includes `superadmin` and whose `iss`/`aud`/`exp` are all valid
- **THEN** the action MUST assign `actor_type = 'superadmin'` and proceed normally

#### Scenario: Missing token returns 403

- **WHEN** a request arrives at any `tenant-config-*` action with no Authorization header
- **THEN** the action MUST return HTTP 403 with an appropriate error message

### Requirement: No privilege derived from unverified payload

The system SHALL NOT evaluate `realm_access.roles`, `scope`, `azp`, or any other claim from a JWT payload before the token's cryptographic signature has been verified.

#### Scenario: Token with tampered payload is rejected even if structurally valid

- **WHEN** a caller presents a JWT whose header and signature correspond to a real token but whose payload has been replaced with an attacker-controlled base64url segment claiming elevated roles
- **THEN** the action MUST return HTTP 403 because signature verification fails over the tampered payload

### Requirement: Async-operation actions MUST NOT accept caller identity from the request payload

The system SHALL NOT derive `callerContext.tenantId`, `callerContext.actor.type`, or `callerContext.actor.id` from the raw incoming request body or action `params` object. The system SHALL source all caller identity fields exclusively from gateway-injected trusted headers (`x-tenant-id`, `x-auth-subject`, `x-actor-type`) or from a JWKS-verified token claim.

#### Scenario: Caller-supplied superadmin actor type is rejected (bbx-callercontext-trust)

- **WHEN** a caller invokes `async-operation-query` with `params.callerContext = { actor: { id: "x", type: "superadmin" }, tenantId: "ten_B" }` directly in the request payload, without valid gateway-trusted headers identifying the caller as a superadmin
- **THEN** the action returns HTTP 401 UNAUTHORIZED and does NOT return operations belonging to tenant ten_B

#### Scenario: Caller-supplied arbitrary tenantId in callerContext is rejected

- **WHEN** a caller invokes `async-operation-query` with `params.callerContext.tenantId` set to a tenant they do not own, without valid gateway-trusted headers mapping the caller to that tenant
- **THEN** the action returns HTTP 401 UNAUTHORIZED and no operations from the target tenant are disclosed

### Requirement: Trusted callerContext MUST be assembled from gateway headers at the action boundary

The system SHALL provide a `buildCallerContext(params)` factory that reads `x-tenant-id`, `x-auth-subject`, and `x-actor-type` from `params.__ow_headers` and returns a verified `callerContext` object. When the required headers are absent or empty the factory SHALL return `null` and the action SHALL respond with HTTP 401 UNAUTHORIZED.

#### Scenario: Missing gateway identity headers cause immediate rejection

- **WHEN** a caller invokes `async-operation-query` or `async-operation-create` without the gateway-injected `x-tenant-id` header
- **THEN** the action returns HTTP 401 UNAUTHORIZED and performs no database read or write

#### Scenario: Valid gateway headers produce a correctly scoped callerContext

- **WHEN** a caller invokes `async-operation-query` with gateway-injected headers `x-tenant-id: ten_A` and `x-actor-type: user`
- **THEN** `resolveTenantScope` scopes the query to tenant ten_A only, and the response contains only operations belonging to ten_A

