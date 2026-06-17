# web-console Specification

## Purpose
TBD - created by archiving change fix-console-tenant-create-path. Update Purpose after archive.
## Requirements
### Requirement: Console tenant creation MUST target an existing route

The system SHALL have the console "new tenant" wizard submit to the real `POST /v1/tenants` control-plane route rather than the non-existent `/v1/admin/tenants`, so UI-driven tenant creation succeeds.

#### Scenario: Creating a tenant from the console succeeds

- **WHEN** an operator completes the console "new tenant" wizard
- **THEN** the console submits to `POST /v1/tenants` and the tenant is created (no `404 NO_ROUTE`)

### Requirement: Console E2E suite includes cross-tenant isolation probes

The system SHALL ensure the console E2E suite includes a cross-tenant isolation probe
that verifies a logged-in tenant user cannot view another tenant's resources in the UI.

#### Scenario: Tenant-A user cannot see tenant-B resources in the console

- **WHEN** a tenant-A user is logged in to the console
- **THEN** tenant-B's workspaces, databases, and users MUST NOT appear in any console
  list view accessible to tenant-A's user

