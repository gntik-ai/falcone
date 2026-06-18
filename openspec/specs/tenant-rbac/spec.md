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

### Requirement: A fully-set-up user MUST be able to authenticate

The system SHALL allow any newly created, fully-set-up user (enabled, email-verified, no required actions, with a password credential) to complete login via `POST /v1/auth/login-sessions` and obtain a token, rather than failing with `invalid_grant "Account is not fully set up"`.

#### Scenario: Freshly created platform user can log in

- **WHEN** a platform user is created and is fully set up, then submits credentials to `POST /v1/auth/login-sessions`
- **THEN** the system returns a valid token and the user can make an authorized call

#### Scenario: A signup can log in after creation

- **WHEN** a self-service signup completes and the user submits credentials
- **THEN** the system returns a valid token (no `invalid_grant` "Account is not fully set up")

### Requirement: Platform Keycloak clients include standard default scopes

The system SHALL create the `in-falcone-console` and `in-falcone-gateway` Keycloak
clients with the standard default client scopes `roles`, `basic`, and `profile` so
that tokens issued to those clients carry `realm_access.roles` and standard profile
claims.

#### Scenario: Superadmin token contains realm_access.roles after fresh install

- **WHEN** a superadmin authenticates via `POST /v1/auth/login-sessions` on a fresh
  install
- **THEN** the returned JWT MUST contain `realm_access.roles` with at least
  `["superadmin"]` and the scope string MUST include `roles`

#### Scenario: Role-gated operations succeed with freshly issued superadmin token

- **WHEN** a superadmin uses the freshly issued token to call a superadmin-gated
  endpoint (e.g. `POST /v1/tenants`)
- **THEN** the response MUST be **201** (or the appropriate success code) and MUST NOT
  be **403**

#### Scenario: Non-superadmin token is correctly denied role-gated endpoints

- **WHEN** a token without the `superadmin` role attempts a superadmin-only operation
- **THEN** the response MUST be **403** — the role check MUST remain effective

### Requirement: Tenant realm is provisioned with a client and tenant_id mapper at tenant creation

The system SHALL, as part of the tenant creation flow, provision in the tenant's
Keycloak realm:
- A client (e.g. `<tenant-slug>-app`) that end-users can authenticate against.
- A `tenant_id` protocol mapper that embeds the tenant's ID into every token issued
  by that realm.

#### Scenario: Tenant-realm token contains tenant_id claim

- **WHEN** a tenant user authenticates against the tenant realm
- **THEN** the issued JWT MUST contain a `tenant_id` claim equal to the owning
  tenant's ID

### Requirement: Executor accepts tokens from tenant-realm issuers

The system SHALL accept JWTs issued by a tenant realm's JWKS endpoint in addition to
the platform realm JWKS, so that tenant users can reach the data-plane and issue API
keys using their tenant-realm token.

The executor MUST validate the `tenant_id` claim from the token and MUST NOT accept
a tenant-A token as authorization for tenant-B resources.

#### Scenario: Tenant owner token is accepted by the executor

- **WHEN** a tenant owner presents a JWT issued by their tenant realm (with a valid
  `tenant_id` claim)
- **THEN** the executor MUST authenticate the request and authorize operations scoped
  to that tenant

#### Scenario: Tenant-A token is denied access to tenant-B resources

- **WHEN** a token issued by tenant-A's realm (with `tenant_id = ten_A`) is used to
  access a resource belonging to `ten_B`
- **THEN** the executor MUST respond **403** and MUST NOT expose tenant-B data

### Requirement: Bootstrap superadmin user is created enabled and can log in immediately

The system SHALL create the superadmin user with `enabled: true`,
`emailVerified: true`, and no required actions so that the superadmin can log in
immediately after a fresh install without any manual intervention.

#### Scenario: Superadmin login succeeds immediately after fresh install

- **WHEN** the bootstrap Job completes on a fresh install
- **THEN** a login attempt for the superadmin user MUST return 201 with a valid
  `tokenSet` and MUST NOT return 401 `Account disabled`

### Requirement: Platform realm user profile preserves tenant_id attribute

The system SHALL configure the platform realm's declarative user profile to preserve
and emit the `tenant_id` (and `workspace_id`) attribute in issued tokens by declaring
them as managed attributes. The attributes SHALL be admin-editable only so a user
cannot self-assign tenant scope.

#### Scenario: tenant_id attribute set on platform user appears in token

- **WHEN** a `tenant_id` attribute is set on a platform realm user and that user
  authenticates
- **THEN** the issued JWT MUST contain the `tenant_id` claim with the correct value

#### Scenario: a platform user cannot self-assign tenant scope

- **WHEN** the platform realm user profile is provisioned
- **THEN** the `tenant_id` and `workspace_id` attributes MUST be editable by `admin`
  only and MUST NOT be editable by `user`

### Requirement: No API to disable/delete app end-users

The system SHALL ensure that no API to disable/delete app end-users is corrected: Implement the disable/delete (and status) end-user routes scoped to the owner's realm.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Owner disables then deletes an app end-user

