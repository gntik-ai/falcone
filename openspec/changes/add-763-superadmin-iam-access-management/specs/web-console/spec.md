# web-console — spec delta for add-763-superadmin-iam-access-management

## ADDED Requirements

### Requirement: Superadmin IAM access page manages full realm IAM lifecycle

The system SHALL let a superadmin create, enable, disable/suspend, and delete realm users and create
realm roles and groups from `/console/iam-access`, in addition to assigning/removing role and group
memberships. The page SHALL confirm destructive membership removals before issuing DELETE, SHALL
provide searchable/paginated users, SHALL use retryable console state handling for loading, empty,
and error states, and SHALL preserve keyboard focus and announce success after mutation refetches.

#### Scenario: Manage a realm user's lifecycle

- **WHEN** a superadmin opens `/console/iam-access` for a tenant realm
- **THEN** they can create a user, enable/disable or suspend the user through
  `PATCH /v1/iam/realms/{realmId}/users/{userId}/status`, and delete the user through
  `DELETE /v1/iam/realms/{realmId}/users/{userId}` from the UI

#### Scenario: Create a realm role then assign it

- **WHEN** a superadmin creates a new realm role from the IAM access page and assigns it to a user
- **THEN** the role is created via `POST /v1/iam/realms/{realmId}/roles` and immediately appears as
  an assignable option, with the assignment submitted to the existing role-assignment endpoint

#### Scenario: Create a realm group then assign it

- **WHEN** a superadmin creates a new realm group from the IAM access page and adds a user to it
- **THEN** the group is created via `POST /v1/iam/realms/{realmId}/groups` and immediately appears
  as an assignable option, with the membership submitted to the existing group-membership endpoint

#### Scenario: Destructive membership change is confirmed

- **WHEN** a superadmin clicks remove for a role or group membership
- **THEN** the console opens a destructive confirmation dialog and does not issue the membership
  DELETE until the superadmin confirms

#### Scenario: Robust states, scale, and accessibility

- **WHEN** the realm has many users, or a load/mutation fails
- **THEN** the users list is searchable and paginated, loading/empty/error states use
  `ConsolePageState` with retry where applicable, and successful mutations announce completion while
  restoring keyboard focus after the refetch
