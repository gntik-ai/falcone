# iam-admin Specification (delta)

## MODIFIED Requirements

### Requirement: IAM create-user request honors documented fields

The system SHALL apply the documented `IamUserCreateRequest` fields when
creating a realm user, including `attributes`, `realmRoles`, and
`bootstrapCredentials`, or reject unsupported documented fields before mutation;
it SHALL NOT return `201 Created` while silently discarding security-relevant
create-user fields.

#### Scenario: attributes are applied

- **WHEN** a superadmin creates a user with `attributes:{tenant_id:["<id>"]}`
- **THEN** the created user carries the `tenant_id` attribute so login can yield
  tenant-scoped claims for that user.

#### Scenario: contract field names match the implementation

- **WHEN** a client sends a create-user request conforming to
  `IamUserCreateRequest` with `realmRoles`, `bootstrapCredentials`, and
  `attributes`
- **THEN** roles, credentials, and attributes are all applied rather than
  silently ignored.

#### Scenario: unsupported create fields fail explicitly

- **WHEN** a create-user request includes a documented field the runtime cannot
  yet perform, such as group assignment or bootstrap email delivery
- **THEN** the system rejects the request before mutating Keycloak instead of
  returning `201 Created` and dropping the field.
