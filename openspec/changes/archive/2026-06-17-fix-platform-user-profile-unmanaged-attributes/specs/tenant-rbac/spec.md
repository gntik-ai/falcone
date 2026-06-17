# tenant-rbac — spec delta for fix-platform-user-profile-unmanaged-attributes

## ADDED Requirements

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
