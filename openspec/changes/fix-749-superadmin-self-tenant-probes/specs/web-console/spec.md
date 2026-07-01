# web-console Specification (delta)

## MODIFIED Requirements

### Requirement: Self-tenant probes are gated by tenant context

The system SHALL gate self-tenant-scoped console requests on the presence of a tenant context and
SHALL render a meaningful platform-admin state on My Plan for a tenant-less principal. The console
SHALL NOT issue self-tenant-scoped requests (`/v1/tenant/*`) for a principal that has no tenant
context, and SHALL present a meaningful state on `/console/my-plan` for such a principal instead of a
raw backend error code.

#### Scenario: Superadmin loads any console page

- **WHEN** a superadmin loads a `/console/*` page
- **THEN** no `/v1/tenant/effective-capabilities` or other self-tenant request is made, OR a 404 from
  it is handled silently without a user-visible raw error

#### Scenario: Superadmin opens My Plan

- **WHEN** a superadmin opens `/console/my-plan`
- **THEN** the page shows a clear no-personal-tenant-plan state, not the raw string
  `TENANT_NOT_FOUND`

#### Scenario: Tenant-less principal

- **WHEN** the active principal has no tenant id
- **THEN** the console does not issue `/v1/tenant/*` self-scoped calls and shows a
  platform-admin-appropriate state
