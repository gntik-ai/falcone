# iam Specification

## Purpose
TBD - created by archiving change fix-iam-user-credentials. Update Purpose after archive.
## Requirements
### Requirement: IAM user creation honors the credentials array

Creating an IAM user SHALL set the password supplied either as the flat `password`
field or as the standard Keycloak `credentials: [{type:'password', value, temporary}]`
array, so a user created with a password can authenticate immediately.

#### Scenario: a user created with a credentials array can log in

- **WHEN** `POST /v1/iam/realms/{realm}/users` is called with
  `credentials: [{type:'password', value:'...'}]`
- **THEN** the password is passed through to Keycloak and a subsequent ROPC login
  succeeds (no `invalid_grant` from a missing credential).

#### Scenario: a temporary credential is preserved

- **WHEN** the credential carries `temporary: true`
- **THEN** the user is created with a temporary password (reset required on first login).

### Requirement: Tenant owners can manage their own realm's app end-users

A tenant owner/admin SHALL be able to list (and, per #567, disable and delete) the app
end-users of the realm owned by its own tenant. The handler SHALL authorize superadmin
OR the owner/admin of the tenant that owns the realm, and SHALL deny any cross-tenant
access (an owner of a different tenant → 403).

#### Scenario: an owner lists its own realm's end-users

- **WHEN** a tenant_owner calls `GET /v1/iam/realms/{realmId}/users` for the realm owned
  by its tenant
- **THEN** the request succeeds (200) and returns that realm's end-users.

#### Scenario: cross-tenant listing is denied

- **WHEN** a tenant_owner of tenant A calls `GET /v1/iam/realms/{realmId}/users` for a
  realm owned by tenant B
- **THEN** the request is rejected with 403 and no Keycloak call is made.

