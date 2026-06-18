# iam — spec delta for fix-iam-user-credentials

## ADDED Requirements

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
