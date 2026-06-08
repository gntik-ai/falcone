# backup-restore Specification

## Purpose
TBD - created by archiving change fix-list-snapshots-tenant-scope. Update Purpose after archive.
## Requirements
### Requirement: Snapshot listing MUST enforce tenant scope for non-global callers

The system SHALL reject any snapshot listing request where the caller holds `backup-status:read:own` but the `tenant_id` query parameter does not match the authenticated actor's `token.tenantId`, returning HTTP 403 with no snapshot data disclosed.

#### Scenario: Own-scope caller cannot list another tenant's snapshots (bbx-snapshots-scope)

- **WHEN** an authenticated actor holding `backup-status:read:own` with `tenantId=ten_A` calls the list-snapshots endpoint with `tenant_id=ten_B`
- **THEN** the system returns HTTP 403 and does not return any snapshot records belonging to tenant B

#### Scenario: Own-scope caller can list their own snapshots

- **WHEN** an authenticated actor holding `backup-status:read:own` with `tenantId=ten_A` calls the list-snapshots endpoint with `tenant_id=ten_A`
- **THEN** the system returns HTTP 200 and the response body contains only snapshot records belonging to tenant A

### Requirement: Global-scope snapshot listing MUST be restricted to platform operators

The system SHALL verify that a caller presenting `backup-status:read:global` is a platform operator before listing snapshots for an arbitrary `tenant_id`; a tenant-scoped actor holding `:global` SHALL receive HTTP 403.

#### Scenario: Tenant-scoped actor with global scope is rejected

- **WHEN** an authenticated actor whose `actorType` is not `platform_operator` holds `backup-status:read:global` and calls the list-snapshots endpoint with a `tenant_id` value differing from `token.tenantId`
- **THEN** the system returns HTTP 403 and does not disclose any snapshot records for the requested tenant

#### Scenario: Platform operator with global scope can list any tenant's snapshots

- **WHEN** an authenticated platform-operator actor holding `backup-status:read:global` calls the list-snapshots endpoint with any valid `tenant_id`
- **THEN** the system returns HTTP 200 and the response body contains snapshot records for the requested tenant

