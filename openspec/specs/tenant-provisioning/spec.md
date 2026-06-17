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

### Requirement: FerretDB init container resolves the DocumentDB host dynamically

The system SHALL derive the DocumentDB service host for the FerretDB init container
from the Helm release name rather than a hardcoded string, so that an install with
any release name converges to the Ready state.

#### Scenario: Fresh install with non-default release name reaches Ready

- **WHEN** the Helm chart is installed with a release name other than `in-falcone`
  (e.g. `falcone`, `my-baas`)
- **THEN** the FerretDB pod's init container MUST connect to the DocumentDB service
  at the correct release-prefixed hostname and MUST transition to `Running` within
  the standard timeout

#### Scenario: Fresh install with default release name is unaffected

- **WHEN** the Helm chart is installed with the default release name `in-falcone`
- **THEN** the FerretDB pod MUST continue to reach Ready state as before

### Requirement: Bootstrap Job completes successfully on a fresh kind install

The system SHALL ensure the Keycloak bootstrap Job reaches the `Complete` state on
a fresh install regardless of the APISIX deployment mode (standalone or admin-API).

When `APISIX_STAND_ALONE=true` the bootstrap Job MUST skip all APISIX admin-API
reconciliation steps and MUST NOT emit any HTTP calls to the APISIX admin API.

#### Scenario: Fresh kind install — bootstrap Job completes

- **WHEN** the Helm chart is installed on a fresh kind cluster with
  `apisix.standaloneMode=true` (or equivalent)
- **THEN** the bootstrap Job MUST reach status `Complete` and the platform realm,
  console client, gateway client, and superadmin user MUST be present in Keycloak

#### Scenario: Bootstrap skips APISIX admin-API in standalone mode

- **WHEN** `APISIX_STAND_ALONE=true` is set and the bootstrap Job runs
- **THEN** the Job log MUST NOT contain any failed HTTP calls to the APISIX admin API
  (`127.0.0.1:9180` or equivalent) and the Job MUST exit 0

#### Scenario: Superadmin can log in after a fresh install

- **WHEN** the bootstrap Job has completed on a fresh install
- **THEN** a superadmin login attempt (`POST /v1/auth/login-sessions`) MUST return 201
  with a `tokenSet` containing valid `realm_access.roles`

### Requirement: helm install --wait converges without deadlock

The FerretDB gateway SHALL be self-sufficient for the documentdb_api schema it depends
on — its init container SHALL create the `documentdb` extension itself (idempotently,
failing closed if the engine image lacks it) rather than only waiting for a post-install
hook — so that `helm install --wait` on a fresh cluster converges to Ready within the
standard Helm timeout with no circular dependency between main resources and hooks.

#### Scenario: helm install --wait completes on a fresh kind cluster

- **WHEN** `helm install --wait` is executed on a fresh kind cluster
- **THEN** all main resources (including FerretDB) MUST reach Ready state and the
  install MUST complete without a `Progress deadline exceeded` timeout

#### Scenario: the gateway creates its own schema dependency

- **WHEN** the FerretDB gateway pod starts
- **THEN** its init container MUST run `CREATE EXTENSION IF NOT EXISTS documentdb` against
  the engine and verify the `documentdb_api` schema before the gateway container starts,
  and MUST NOT depend on the post-install hook Job for that critical-path schema

### Requirement: At least one app secret resolves from Vault when Vault is enabled

The system SHALL wire at least one application secret through Vault (via ESO or
equivalent) so that enabling Vault provides a real end-to-end secrets resolution path.

#### Scenario: App secret resolves from Vault

- **WHEN** Vault is enabled and a configured secret is stored in Vault
- **THEN** the consuming application MUST receive the secret value from Vault and
  MUST NOT fall back to a plain Kubernetes Secret for that value

### Requirement: Deployed release contains no legacy migration-era components

A deployment from current chart source SHALL contain no MongoDB, MinIO (legacy), or
OpenWhisk workloads, container images, or host env values, and the control-plane and
executor SHALL reference FerretDB (documentdb) and SeaweedFS respectively. The chart
SHALL fail closed (render error) if a legacy `mongodb`, `minio`, or `openwhisk` values
stanza is reintroduced.

#### Scenario: No legacy workloads present after deploy from current chart

- **WHEN** the chart is rendered from current source HEAD
- **THEN** no rendered workload/Service/Job MUST be named for `mongodb`, `minio`, or
  `openwhisk`, no container image MUST reference them, and no env value MUST pin a
  legacy host; the data-plane env MUST reference the documentdb (FerretDB) engine and
  SeaweedFS

#### Scenario: Guard fails if a legacy stanza is reintroduced

- **WHEN** the chart is rendered with a `mongodb`, `minio`, or `openwhisk` values stanza set
- **THEN** the render MUST exit non-zero with an error naming the offending legacy component

### Requirement: Kind profile supports advanced capabilities via opt-in overlay

The system SHALL provide a `values-kind-advanced.yaml` overlay that enables realtime
(PG-table SSE at minimum), Temporal-backed workflows, and MCP hosting on a kind
cluster so that these capabilities can be exercised and tested without a production
deployment.

#### Scenario: Realtime SSE endpoint is reachable with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay
- **THEN** the realtime SSE endpoint (PG-table change stream) MUST respond to a
  subscription request and MUST deliver change events

#### Scenario: Flows API responds with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay (Temporal +
  workflow-worker up and `TEMPORAL_ADDRESS` set on the executor)
- **THEN** the workspace-scoped Flows endpoints (`GET /v1/flows/workspaces/{ws}/task-types`
  and `GET /v1/flows/workspaces/{ws}/flows`) MUST return 200 with a list response and
  MUST NOT return 404 / 501

#### Scenario: MCP hosting routes are registered with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay (`MCP_ENABLED=true`)
- **THEN** `GET /v1/mcp/workspaces/{ws}/servers` MUST be a registered route returning 200
  (not 404)

