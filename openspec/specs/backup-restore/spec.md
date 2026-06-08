# backup-restore Specification

## Purpose
TBD - created by archiving change fix-backup-operation-fetch-idor. Update Purpose after archive.
## Requirements
### Requirement: Single-operation fetch MUST be tenant-scoped for non-global callers

The system SHALL include the authenticated actor's `tenant_id` as a predicate in the query that retrieves a single backup operation by ID for any caller that does NOT hold the platform-level `backup:read:global` scope, so that an operation record belonging to a different tenant is never returned to a tenant-scoped caller.

#### Scenario: Cross-tenant operation ID returns 404 not 403 (bbx-backup-op-idor)

- **WHEN** a tenant-scoped actor (no `backup:read:global`) for tenant A calls the get-operation endpoint with an operation ID that belongs to tenant B
- **THEN** the response is HTTP 404 and the response body does not reveal any detail about the cross-tenant operation, providing no existence signal to the caller

### Requirement: Backup operation access check MUST enforce tenant ownership before revealing existence

The system SHALL perform the tenant-scoped lookup before any access-control decision so that a missing tenant predicate cannot be exploited as an existence oracle distinguishing 404 (not found) from 403 (access denied) for tenant-scoped callers.

#### Scenario: Cross-tenant probe produces identical response to non-existent ID

- **WHEN** a tenant-scoped actor requests an operation ID that exists in the database but belongs to a different tenant
- **THEN** the system returns the same HTTP 404 response it would return for a non-existent ID, with no body field indicating the operation exists

### Requirement: backup:read:global is a platform-level read scope for single-operation fetch

The system SHALL treat `backup:read:global` as an explicitly-granted platform-level scope whose holder MAY read a single backup operation across tenants via an unscoped lookup; this scope is granted deliberately and is distinct from the per-tenant default. Callers without it remain tenant-scoped per the requirements above.

#### Scenario: Global read scope reads a cross-tenant operation

- **WHEN** an actor holding `backup:read:global` requests an operation ID belonging to a tenant other than the actor's own
- **THEN** the system performs an unscoped lookup and returns HTTP 200 with the operation body (the scope intentionally grants cross-tenant read)

#### Scenario: Non-existent operation returns 404 for a global reader

- **WHEN** an actor holding `backup:read:global` requests an operation ID that does not exist
- **THEN** the system returns HTTP 404
