# Tasks — fix-platform-user-profile-unmanaged-attributes

## Implementation
- [x] Locate the platform realm's declarative user profile
  (`bootstrap.oneShot.keycloak.userProfile` in `charts/in-falcone/values.yaml`); confirm the
  bootstrap PUTs it idempotently to `.../users/profile`.
- [x] Declare `tenant_id` (and `workspace_id`) as managed attributes in the user profile, rather
  than enabling arbitrary unmanaged attributes — the tenant-context / workspace-context client
  scopes already map these user attributes into the token.
- [x] Make both attributes admin-edit only (`edit: [admin]`) so a user cannot self-assign tenant
  scope; `view: [admin, user]`.

## Verification
- [x] Black-box test `tests/blackbox/platform-user-profile-tenant-attr.test.mjs` (bbx-a4-01/02)
  asserts the rendered user profile declares both attributes admin-edit only.
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-platform-user-profile-unmanaged-attributes --strict`.

## Archive
- [x] `/opsx:archive fix-platform-user-profile-unmanaged-attributes`
