# backup-restore Specification

## Purpose
TBD - created by archiving change fix-confirm-restore-tenant-gate. Update Purpose after archive.
## Requirements
### Requirement: Restore confirmation MUST enforce tenant ownership unconditionally at the service layer

The system SHALL reject a restore confirmation request at the service layer whenever the acting actor's `tenantId` does not match the `tenantId` on the confirmation request, unless the actor holds a documented platform-level superadmin scope, regardless of whether `tenant_id` was supplied in the request body.

#### Scenario: Cross-tenant restore confirmation without tenant_id is rejected (bbx-confirm-restore-crosstenant)

- **WHEN** an actor authenticated for tenant B, holding `backup:restore:global`, calls the confirm-restore endpoint with a valid confirmation token belonging to a pending restore request for tenant A, and the request body does NOT include a `tenant_id` field
- **THEN** the system returns HTTP 403 and does not execute the restore, and no confirmation state change is written to the database

### Requirement: Restore confirmation action layer MUST treat tenant_id as a required field

The system SHALL require the `tenant_id` field in the confirm-restore request body and SHALL unconditionally reject requests where `body.tenant_id` does not match `token.tenantId` for non-superadmin callers, mirroring the behaviour of initiate-restore.

#### Scenario: Omitting tenant_id from confirm-restore body is rejected at the action layer

- **WHEN** a non-superadmin actor submits a confirm-restore request body that does not include a `tenant_id` field
- **THEN** the system returns HTTP 400 indicating that `tenant_id` is a required field

### Requirement: Tenant-name confirmation MUST NOT serve as the sole authorization boundary for restore

The system SHALL treat the `tenantNameConfirmation` field as a UX safety check only; tenant ownership authorization SHALL be enforced by a dedicated tenant identity check that precedes and is independent of the tenant-name string match.

#### Scenario: Knowing the target tenant name does not bypass the tenant ownership gate

- **WHEN** an actor belonging to tenant B submits a confirm-restore request with the correct `tenantNameConfirmation` string for tenant A's restore request, but with `tenant_id` set to tenant A's ID (not the actor's own tenant)
- **THEN** the system returns HTTP 403 before evaluating the tenant-name string, and the restore is not executed

