# scheduling Specification

## Purpose
TBD - created by archiving change parameterize-scheduling-status-filter. Update Purpose after archive.
## Requirements
### Requirement: Job-list status filter is parameterized and allowlist-validated

The system SHALL replace any string-concatenated SQL construction of the status filter in the list-jobs query with a positional placeholder (`$4`) and MUST validate the caller-supplied status value against the allowlist `{active, paused, errored, deleted}` derived from `VALID_TRANSITIONS` (`services/scheduling-engine/src/job-model.mjs::VALID_TRANSITIONS:4-9`) before appending it to the query parameters. The system SHALL return HTTP 400 with error code `INVALID_STATUS` for any status value outside the allowlist, without executing the query.

#### Scenario: SQL injection payload in status filter is rejected before query execution

- **WHEN** an authenticated caller supplies `status=active' OR '1'='1` as the query parameter for `GET /v1/scheduling/jobs`
- **THEN** the system returns HTTP 400 with error code `INVALID_STATUS`
- **AND** no database query is executed against `scheduled_jobs`

#### Scenario: Valid status filter returns only the authenticated tenant's jobs

- **WHEN** an authenticated caller supplies `status=active` as the query parameter for `GET /v1/scheduling/jobs`
- **THEN** the system executes a parameterized query with `tenant_id = $1 AND workspace_id = $2 AND status = $4`
- **AND** the response contains only jobs belonging to the caller's tenant and workspace

#### Scenario: Absent status filter returns only the authenticated tenant's jobs without status predicate

- **WHEN** an authenticated caller omits the `status` query parameter for `GET /v1/scheduling/jobs`
- **THEN** the system executes a parameterized query with `tenant_id = $1 AND workspace_id = $2` and no status predicate
- **AND** the response contains only jobs belonging to the caller's tenant and workspace

### Requirement: Job-list SQL injection cannot produce cross-tenant row disclosure

The system SHALL ensure that no value of the `status` HTTP query parameter causes the list-jobs SQL query to return rows belonging to a tenant other than the authenticated caller's tenant. The `tenant_id` and `workspace_id` predicates MUST remain effective regardless of the status parameter value.

#### Scenario: UNION injection payload returns 400, not cross-tenant rows

- **WHEN** an authenticated caller supplies a `status` value containing a SQL `UNION` or comment sequence (e.g. `x' UNION SELECT id,null,null,null FROM scheduled_jobs--`)
- **THEN** the system returns HTTP 400 with error code `INVALID_STATUS`
- **AND** no rows from other tenants are included in any response

### Requirement: Status allowlist is derived from the authoritative job model

The system SHALL derive the accepted status values exclusively from `VALID_TRANSITIONS` keys in `services/scheduling-engine/src/job-model.mjs::VALID_TRANSITIONS:4-9`, so that the API-layer allowlist stays synchronized with the job state machine without requiring a separate maintenance step.

#### Scenario: Unrecognized status value is rejected

- **WHEN** an authenticated caller supplies a status value not present in `VALID_TRANSITIONS` (e.g. `status=unknown`)
- **THEN** the system returns HTTP 400 with error code `INVALID_STATUS`
- **AND** no database query is executed

### Requirement: Scheduling identity is derived exclusively from verified JWT claims

The system SHALL derive `tenantId`, `workspaceId`, and `actorId` for all scheduling operations exclusively from `params.jwt` (the verified token payload injected by the API gateway). The system SHALL NOT fall back to `params.tenantId`, `params.workspaceId`, or `params.actorId` from the request body or query string. The system SHALL treat those request fields as untrusted and ignore them when `params.jwt` is present.

#### Scenario: Request with body tenantId but no JWT is rejected

- **WHEN** a caller sends a scheduling request supplying `tenantId` and `workspaceId` in the request body but without a valid JWT
- **THEN** the system returns HTTP 401 / `UNAUTHENTICATED` before any scheduling operation is executed

#### Scenario: Request with valid JWT uses token claims for identity

- **WHEN** a caller sends a scheduling request with a valid JWT containing `tenantId` and `workspaceId` claims
- **THEN** the system derives the identity from `params.jwt.tenantId` and `params.jwt.workspaceId`, ignoring any conflicting values in the request body

### Requirement: Absent or incomplete JWT claims cause hard rejection

The system SHALL return HTTP 401 / `UNAUTHENTICATED` when `params.jwt` is absent, or when `params.jwt.tenantId` or `params.jwt.workspaceId` are absent or empty, before executing any scheduling read or write operation.

#### Scenario: Missing jwt.tenantId is rejected

- **WHEN** a scheduling request arrives with a JWT that does not contain a `tenantId` claim
- **THEN** the system returns HTTP 401 before any DB query is executed

#### Scenario: Missing jwt.workspaceId is rejected

- **WHEN** a scheduling request arrives with a JWT that does not contain a `workspaceId` claim
- **THEN** the system returns HTTP 401 before any DB query is executed

### Requirement: Scheduling operations are scoped to the token-derived tenant and workspace

The system SHALL use only the token-derived `tenantId` and `workspaceId` as the scope predicates for all scheduling reads and writes, so that one authenticated tenant cannot access or modify another tenant's scheduling resources.

#### Scenario: Cross-tenant job access is prevented by token-scoped identity

- **WHEN** an authenticated caller whose JWT contains `tenantId=A` requests scheduling jobs
- **THEN** the system returns only jobs scoped to `tenantId=A` and returns no jobs belonging to any other tenant

