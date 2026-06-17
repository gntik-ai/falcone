# Tasks — fix-platform-user-profile-unmanaged-attributes

## Implementation
- [ ] Locate the platform realm's user profile configuration in `services/keycloak-config/`.
- [ ] Either add `tenant_id` as an explicit attribute in the declarative user profile,
  or set `unmanagedAttributePolicy: ENABLED` on the realm configuration.
- [ ] Optionally add `workspace_id` as well if needed by any downstream flow.

## Verification
- [ ] Set `tenant_id` on a platform user → attribute appears in the issued token.
- [ ] Run `/opsx:verify fix-platform-user-profile-unmanaged-attributes`.

## Archive
- [ ] `/opsx:archive fix-platform-user-profile-unmanaged-attributes`
