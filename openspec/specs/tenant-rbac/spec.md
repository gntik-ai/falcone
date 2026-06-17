# tenant-rbac Specification

## Purpose
TBD - created by archiving change add-tenant-custom-rbac. Update Purpose after archive.
## Requirements
### Requirement: Custom role creation scoped to tenant

The system SHALL allow a tenant admin to create a custom role namespaced with the
`custom:` prefix, binding a non-empty subset of permission_matrix actions, persisted
under the requesting tenant's `(tenant_id, workspace_id)`.

#### Scenario: Tenant admin creates a valid custom role

- **WHEN** a tenant admin submits `POST /v1/iam/tenant-roles` with a role name
  prefixed `custom:` and an `allowed_actions` array that is a strict subset of the
  admin's own effective permissions
- **THEN** the system persists the role under the admin's `(tenant_id, workspace_id)`
  and returns the created role record with HTTP 201

#### Scenario: Custom role name collision with reserved names is rejected

- **WHEN** a tenant admin submits `POST /v1/iam/tenant-roles` with a role name
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

### Requirement: Custom role bindings persisted and exposed for effective-permissions resolution

The system SHALL persist an active custom role's `allowed_actions` under its
`(tenant_id, workspace_id)` and expose those bindings so the effective-permissions
resolver / token issuance can fold them into a user's resolved permission set, and
SHALL emit the `tenant.effective_permissions.recalculate` trigger whenever a custom
role is created, updated, or deleted.

> Note: the end-to-end runtime enforcement (the gateway scope-enforcement plugin
> observing a custom binding on a live request) is delivered with the Keycloak
> token-issuance + gateway half and is intentionally out of scope for this change;
> this requirement covers the persistence + exposure + recalculation-trigger
> contract that the resolver consumes.

#### Scenario: Custom role binding is persisted and retrievable for resolution

- **WHEN** a tenant admin creates a custom role that grants `workspace.policy.manage`
  via `POST /v1/iam/tenant-roles`
- **THEN** the binding is persisted under the admin's `(tenant_id, workspace_id)` with
  `allowed_actions` including `workspace.policy.manage` and is retrievable through the
  tenant-scoped read/list endpoints for the effective-permissions resolver to consume

#### Scenario: Recalculation triggered on custom role deletion

- **WHEN** a tenant admin deletes an active custom role via
  `DELETE /v1/iam/tenant-roles/{roleId}`
- **THEN** the system soft-deletes the role (`deleted_at`) and emits the
  `tenant.effective_permissions.recalculate` trigger for the affected
  `(tenant_id, workspace_id)` so that resolution no longer reflects the deleted role

### Requirement: Custom role reads are always tenant-scoped

The system SHALL scope all reads of custom roles to the caller's own
`(tenant_id, workspace_id)`; a caller from Tenant A MUST NOT be able to read,
modify, or delete custom roles belonging to Tenant B.

#### Scenario: Cross-tenant role read is denied

- **WHEN** an authenticated user from Tenant A calls
  `GET /v1/iam/tenant-roles/{roleId}` where `roleId` belongs to Tenant B
- **THEN** the system responds with HTTP 404 (not 403, to avoid ID enumeration)
  and does not reveal any data about Tenant B's custom roles

### Requirement: Self-service signups MUST be created in the tenant's realm

The system SHALL create a self-service signup (`POST /v1/auth/signups {tenantId}`) in the target tenant's `iam_realm` rather than in the shared `in-falcone-platform` realm, and SHALL stamp the user's `tenant_id`/`workspace_id` attributes.

#### Scenario: Signup lands in the tenant realm with tenant claims

- **WHEN** a self-service signup is submitted for tenant `T`
- **THEN** the created user exists only in `T`'s `iam_realm`, carries `tenant_id`/`workspace_id` attributes, and does not appear in `in-falcone-platform`

#### Scenario: Platform realm holds only platform principals

- **WHEN** any number of self-service signups are submitted for tenant `T`
- **THEN** the `in-falcone-platform` realm contains no signup-created end-users

