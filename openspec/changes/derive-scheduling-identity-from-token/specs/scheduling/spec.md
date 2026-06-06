## ADDED Requirements

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
