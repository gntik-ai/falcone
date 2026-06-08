# tenant-provisioning Specification

## Purpose
TBD - created by archiving change fix-async-operation-trusted-context. Update Purpose after archive.
## Requirements
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

