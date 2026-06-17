# fix-platform-user-profile-unmanaged-attributes

## Change type
bug-fix

## Capability
tenant-rbac (cap-iam-admin)

## Priority
P2

## Why (Problem Statement)
The platform realm's declarative user profile drops the `tenant_id` attribute because
`unmanagedAttributePolicy` is off. Setting `tenant_id` on a platform user has no
effect — it does not appear in the token.

**Evidence (live campaign 2026-06-17):**
- Setting `tenant_id` attribute on a platform user → absent from token until
  `unmanagedAttributePolicy=ENABLED` is manually set.
- A4 in the campaign report.

## What Changes
Add `tenant_id` (and `workspace_id` if needed) to the declarative user profile in
the platform realm configuration, or set `unmanagedAttributePolicy=ENABLED` so the
attribute is preserved and emitted in tokens.

## Impact
- **Security:** platform users (ops users with platform-realm tokens) cannot carry
  tenant scope without this fix, limiting their ability to use tenant-scoped endpoints.
- **Breaking change:** none.
- **Dependencies:** pairs with D.2 for full tenant token path.
