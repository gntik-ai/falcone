# Proposal: tenant scoped console sessions

## Why

Signup creates users in a tenant Keycloak realm, but console login uses the platform realm. Those users cannot start a console session.

## What changes

- Accept an optional tenant ID for login, refresh, and logout. Resolve an active tenant's realm and public app client from the tenants row.
- Keep platform authentication as the default when the tenant ID is omitted.
- Carry the selected tenant ID through the console login and stored session so refresh and logout target the same realm.
- Add the optional field to the public OpenAPI request schemas.

## Risks and rollback

This is an R3 tenant isolation change. Unknown, inactive, and unprovisioned tenants must fail before Keycloak. Existing tenant realms without the app client will need separate reprovisioning. The login schema still requires 12 password characters while signup permits 8; gateway enforcement may reject short passwords. Revert the source images to prior digests to roll back; there is no data migration.

## Non goals

No changes to signup realm selection, JWT verification, workspace binding, password policy, Helm, or Keycloak provisioning.
