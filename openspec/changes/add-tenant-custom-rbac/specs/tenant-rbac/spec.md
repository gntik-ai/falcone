# Tenant RBAC

## ADDED Requirements

### Requirement: Custom role creation scoped to tenant

The system SHALL allow a tenant admin to create a custom role namespaced with the
`custom:` prefix, binding a non-empty subset of permission_matrix actions, persisted
under the requesting tenant's `(tenant_id, workspace_id)`.

#### Scenario: Tenant admin creates a valid custom role

- **WHEN** a tenant admin submits `POST /v1/admin/iam/tenant-roles` with a role name
  prefixed `custom:` and an `allowed_actions` array that is a strict subset of the
  admin's own effective permissions
- **THEN** the system persists the role under the admin's `(tenant_id, workspace_id)`
  and returns the created role record with HTTP 201

#### Scenario: Custom role name collision with reserved names is rejected

- **WHEN** a tenant admin submits `POST /v1/admin/iam/tenant-roles` with a role name
  that matches any entry in `RESERVED_ROLE_NAMES` (e.g. `tenant_admin`, `workspace_owner`)
  or lacks the `custom:` prefix
- **THEN** the system rejects the request with HTTP 422 and an error body identifying
  the name collision

### Requirement: Custom role actions bounded by creator permissions

The system SHALL reject any custom role whose `allowed_actions` contains an action
not held by the requesting principal, ensuring privilege escalation via role creation
is impossible.

#### Scenario: Escalation attempt is rejected

- **WHEN** a tenant admin attempts to create a custom role with an `allowed_actions`
  entry that the admin does not hold in their own effective permissions (e.g. a
  `tenant_developer` trying to grant `tenant.suspend`)
- **THEN** the system responds with HTTP 403 and does not persist the role

#### Scenario: Custom role cannot grant cross-tenant actions

- **WHEN** a tenant admin attempts to include any platform-scoped action (e.g.
  `tenant.suspend`, `app.admin`, `service_account.admin`) in a custom role's
  `allowed_actions`
- **THEN** the system responds with HTTP 403 regardless of the admin's own role
  and does not persist the role

### Requirement: Custom roles folded into effective-permissions resolution

The system SHALL include active custom roles when computing a user's effective
permissions so that downstream consumers (gateway scope-enforcement, audit checks)
observe the full permission set without code changes.

#### Scenario: User with custom role binding passes scope check

- **WHEN** a user is assigned a custom role that grants `workspace.policy.manage`
  and the user calls an endpoint requiring that action
- **THEN** the gateway scope-enforcement plugin permits the request (HTTP 2xx) using
  the resolved effective permissions that include the custom role

#### Scenario: Effective permissions recalculated after custom role deletion

- **WHEN** a tenant admin deletes an active custom role via
  `DELETE /v1/admin/iam/tenant-roles/{roleId}`
- **THEN** the system triggers `tenant.effective_permissions.recalculate` for all
  affected principals and subsequent scope checks no longer reflect the deleted role

### Requirement: Custom role reads are always tenant-scoped

The system SHALL scope all reads of custom roles to the caller's own
`(tenant_id, workspace_id)`; a caller from Tenant A MUST NOT be able to read,
modify, or delete custom roles belonging to Tenant B.

#### Scenario: Cross-tenant role read is denied

- **WHEN** an authenticated user from Tenant A calls
  `GET /v1/admin/iam/tenant-roles/{roleId}` where `roleId` belongs to Tenant B
- **THEN** the system responds with HTTP 404 (not 403, to avoid ID enumeration)
  and does not reveal any data about Tenant B's custom roles
