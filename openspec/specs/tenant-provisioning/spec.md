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

### Requirement: Workspace sub-quota allocation MUST enforce the tenant effective limit against the database

The system SHALL, when setting a workspace sub-quota for a tenant quota dimension, compute the sum of the tenant's other workspaces' allocations for that dimension via a query that is valid on PostgreSQL (it MUST NOT combine `FOR UPDATE` with an aggregate function), and SHALL reject — with HTTP 422 — any allocation that would drive the tenant's total allocation for that dimension above the tenant's effective limit. A bounded-limit dimension MUST be enforceable on the real database, not only against an in-memory test store.

#### Scenario: Setting a sub-quota within the tenant limit succeeds on PostgreSQL

- **WHEN** a tenant owner sets a workspace sub-quota for a dimension whose allocation (plus the tenant's other workspace allocations for that dimension) does not exceed the tenant's effective limit
- **THEN** the system persists the allocation and returns HTTP 201 (new) or HTTP 200 (updated), and does NOT raise a database error from combining `FOR UPDATE` with an aggregate

#### Scenario: Setting a sub-quota above the tenant limit is rejected

- **WHEN** a tenant owner sets a workspace sub-quota whose value would drive the tenant's total allocation for that dimension above the tenant's effective limit
- **THEN** the system returns HTTP 422 (`SUB_QUOTA_EXCEEDS_TENANT_LIMIT`) and does not persist the allocation

#### Scenario: Concurrent sub-quota writes are serialized by a row lock

- **WHEN** the sub-quota total for a dimension is computed during an allocation
- **THEN** the sibling sub-quota rows for that tenant and dimension are locked (`FOR UPDATE` on a non-aggregate subquery) so concurrent allocations cannot collectively exceed the tenant effective limit

### Requirement: Tenant purge cascades to the MCP domain
The tenant purge sweep SHALL include an MCP domain teardown that removes the tenant's MCP runtime footprint — its hosted MCP-server workloads and its MCP metadata — with the same partial-failure semantics as the other purge domains (IAM, Postgres, Mongo, Kafka, storage, functions, workflows): if the MCP teardown reports any error, the sweep MUST NOT finalize the purge.

#### Scenario: MCP teardown removes the tenant's MCP footprint
- **WHEN** a tenant is purged
- **THEN** the sweep's MCP teardown deletes the tenant's MCP-server workloads and MCP metadata rows, tenant-scoped

#### Scenario: MCP teardown failure blocks purge finalization
- **WHEN** the MCP teardown reports an error during a purge
- **THEN** the sweep does not finalize the purge and surfaces a partial failure for the tenant

#### Scenario: MCP teardown is idempotent
- **WHEN** the MCP teardown runs again for a tenant whose MCP resources are already gone (or were never provisioned)
- **THEN** it removes nothing and returns without error

### Requirement: Workspace creation MUST provision a real backing database

The system SHALL, when a workspace is created, complete the provisioning saga that creates the backing `wsdb_*` Postgres database, and SHALL NOT leave a `workspace_databases` registry row without a corresponding physical database.

#### Scenario: A new workspace gets a real database

- **WHEN** a client calls `POST /v1/workspaces` and the provisioning saga completes
- **THEN** the backing `wsdb_*` Postgres database exists and the data API connects to it

#### Scenario: No orphaned registry rows

- **WHEN** a workspace's provisioning saga fails to create the physical database
- **THEN** the system does not report the workspace as ready with an orphaned registry row

### Requirement: A project MUST support multiple isolated environments

The system SHALL model environment (e.g. prod/staging/dev) as a first-class concept so that a project can hold multiple environments, each with its own isolated resource set (database, bucket, topics, secrets), rather than treating environment as a workspace slug only.

#### Scenario: Two environments have isolated resources

- **WHEN** a project is created with a `prod` and a `staging` environment
- **THEN** each environment has its own database, bucket, topics, and secrets, and data written in one environment is not visible in the other

#### Scenario: Environment is a first-class create dimension

- **WHEN** a client creates an environment for a project
- **THEN** the system records it as a distinct environment entity with its own provisioned resources

