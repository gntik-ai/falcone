# web-console — spec delta for add-live-e2e-console-playwright

## ADDED Requirements

### Requirement: Playwright E2E suite covers all console admin actions

The system SHALL provide a real-stack Playwright E2E suite under `tests/e2e/` that
drives every console admin action end-to-end against a live Falcone installation on
kind, including tenant creation, workspace management, user management, database
provisioning, and storage bucket management.

#### Scenario: Console admin can create a tenant end-to-end via the UI

- **WHEN** a Playwright spec logs in as superadmin via the console UI and creates
  a new tenant
- **THEN** the tenant MUST appear in both the console tenant list and the
  `GET /v1/tenants` API response

## ADDED Requirements

### Requirement: Console E2E suite includes cross-tenant isolation probes

The system SHALL ensure the console E2E suite includes a cross-tenant isolation probe
that verifies a logged-in tenant user cannot view another tenant's resources in the UI.

#### Scenario: Tenant-A user cannot see tenant-B resources in the console

- **WHEN** a tenant-A user is logged in to the console
- **THEN** tenant-B's workspaces, databases, and users MUST NOT appear in any console
  list view accessible to tenant-A's user
