# tenant-rbac — spec delta for fix-platform-user-profile-unmanaged-attributes

## MODIFIED Requirements

### Requirement: Platform realm user profile preserves tenant_id attribute

The system SHALL configure the platform realm's user profile to preserve and emit
the `tenant_id` attribute in issued tokens, either by declaring it as an explicit
attribute or by enabling `unmanagedAttributePolicy`.

#### Scenario: tenant_id attribute set on platform user appears in token

- **WHEN** a `tenant_id` attribute is set on a platform realm user and that user
  authenticates
- **THEN** the issued JWT MUST contain the `tenant_id` claim with the correct value
