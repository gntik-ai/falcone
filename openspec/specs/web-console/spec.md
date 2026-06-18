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

### Requirement: Console shell unusable for tenant operators

The system SHALL ensure that console shell unusable for tenant operators is corrected: Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An operator logs in and sees their own tenant/workspaces/plan

### Requirement: Console session whoami endpoint exists and operator pages are role-correct

The console session endpoint `GET /v1/console/session` SHALL be implemented as an
authenticated whoami that returns the verified principal, so the web-console reconnect
sync and shell no longer hit a dead 404. Operator-facing plan pages SHALL use
operator-authorized (own-scope) routes, and superadmin-only pages SHALL be role-gated.

#### Scenario: the console session endpoint resolves for an authenticated principal

- **WHEN** an authenticated operator's console calls `GET /v1/console/session`
- **THEN** it returns 200 with the verified principal (no 404) and never echoes a
  body/header-supplied identity.

#### Scenario: the my-plan page uses the operator route

- **WHEN** a tenant operator opens `/console/my-plan`
- **THEN** the page reads `/v1/tenant/plan/effective-entitlements` (operator-authorized),
  not the superadmin `/v1/tenants/{id}/plan`; the superadmin plans/tenants pages remain
  role-gated.

