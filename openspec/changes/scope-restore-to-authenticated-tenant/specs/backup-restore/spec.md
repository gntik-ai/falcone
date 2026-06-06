## ADDED Requirements

### Requirement: Restore target tenant must match the authenticated caller's tenant

The system SHALL compare `body.tenant_id` in every restore-initiate and restore-confirm request to the `tenantId` extracted from the verified JWT. The system SHALL return HTTP 403 when `body.tenant_id` does not equal `token.tenantId`, unless the caller's verified scopes include a platform-level cross-tenant privilege (e.g. `superadmin`). The system SHALL NOT initiate or confirm a restore for a tenant other than the authenticated caller's tenant.

#### Scenario: Tenant A cannot initiate a restore for tenant B

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-initiate endpoint with `body.tenant_id` set to tenant B
- **THEN** the system returns HTTP 403 before queuing or initiating any restore operation
- **AND** no restore record for tenant B is created

#### Scenario: Tenant A cannot confirm a restore for tenant B

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-confirm endpoint for a restore request that belongs to tenant B
- **THEN** the system returns HTTP 403 before executing any confirmation or destructive data operation
- **AND** tenant B's data is unchanged

#### Scenario: Tenant A can initiate a restore for tenant A

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-initiate endpoint with `body.tenant_id` set to tenant A
- **THEN** the system proceeds with restore initiation for tenant A

### Requirement: Confirmation status lookup is scoped to the authenticated caller's tenant

The system SHALL assert that the `tenantId` on a restore request matches the authenticated caller's `tenantId` before returning status or allowing confirmation to proceed. The system SHALL return HTTP 403 when `actor.tenantId` does not match `request.tenantId`, unless the caller holds a verified platform-level cross-tenant privilege.

#### Scenario: Status lookup for another tenant's restore request is rejected

- **WHEN** a caller with `actor.tenantId` equal to tenant A calls `ConfirmationsService.getStatus` for a restore request whose `tenantId` is tenant B
- **THEN** the system returns HTTP 403 and does not reveal any details of tenant B's restore request

### Requirement: Tenant-name confirmation gate requires an authoritative resolver

The system SHALL NOT resolve a tenant name by returning the raw `tenantId` string. The system SHALL require a wired, authoritative resolver for `resolveTenantName` and SHALL fail safely (return an error) if no resolver is configured. The destructive-action confirmation gate SHALL compare `body.tenantNameConfirmation` only to the resolved authoritative name, not to the raw tenant identifier.

#### Scenario: Confirmation with raw tenant id is rejected when resolver is wired

- **WHEN** an authoritative resolver is configured and the resolved tenant name differs from the raw `tenantId` string
- **AND** a caller submits `tenant_name_confirmation` equal to the raw `tenantId`
- **THEN** the system returns HTTP 422 and does not proceed with the destructive operation

#### Scenario: Confirmation fails safely when no resolver is configured

- **WHEN** `resolveTenantName` is called with no resolver wired
- **THEN** the system returns an error instead of echoing back the raw `tenantId`
- **AND** the confirmation gate is not satisfied
