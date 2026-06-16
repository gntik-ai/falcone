## ADDED Requirements

### Requirement: Data-plane operations MUST be bound to the credential's workspace

The system SHALL verify, on every data-plane operation, that the `workspaceId`, `databaseName`, or `bucketId` taken from the request path resolves to the authenticated credential's tenant/workspace, and SHALL reject any request where the path resource does not belong to the credential with HTTP 403 before performing any side effect. This check SHALL apply uniformly to the postgres, mongo, events, functions, realtime, and api-keys surfaces.

#### Scenario: Cross-tenant data-plane request is rejected

- **WHEN** a request bearing Tenant B's credential targets a path containing Tenant A's `workspaceId`/`databaseName`/`bucketId`
- **THEN** the system returns HTTP 403 and performs no read, write, publish, invoke, or delete against Tenant A's resources

#### Scenario: Same-tenant data-plane request succeeds

- **WHEN** a request bearing Tenant B's credential targets a path whose `workspaceId` belongs to Tenant B
- **THEN** the system processes the operation and returns the appropriate success status
