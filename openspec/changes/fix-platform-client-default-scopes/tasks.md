# Tasks — fix-platform-client-default-scopes

## Implementation
- [ ] Locate the bootstrap Job's client creation payload for `in-falcone-console`
  (in `services/keycloak-config/` or the bootstrap script).
- [ ] Add `defaultClientScopes: ["roles", "basic", "profile", <existing scopes>]`
  to the console client payload.
- [ ] Apply the same fix to the `in-falcone-gateway` client payload.
- [ ] Add an idempotent patch step (for existing deployments) that assigns the
  missing scopes via the Keycloak REST API.

## Verification
- [ ] Fresh install → superadmin token contains `realm_access.roles`.
- [ ] `POST /v1/tenants` with superadmin token → 201.
- [ ] Run `bash tests/blackbox/run.sh`.
- [ ] Run `/opsx:verify fix-platform-client-default-scopes`.

## Archive
- [ ] `/opsx:archive fix-platform-client-default-scopes`
