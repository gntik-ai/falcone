# Tasks — fix-tenant-realm-token-issuance

## Investigation
- [ ] Determine the intended token path: multi-realm JWKS on the executor, or token
  exchange from tenant realm → platform realm.
- [ ] Identify the tenant creation handler in `services/keycloak-config/` /
  `apps/control-plane/` that provisions the tenant realm.

## Implementation (tenant realm provisioning)
- [ ] Add client creation step to the tenant creation flow:
  create `<tenant-slug>-app` client in the tenant realm.
- [ ] Add a `tenant_id` protocol mapper to the client/realm that embeds the
  owning tenant's ID in issued tokens.

## Implementation (executor JWKS)
- [ ] Add multi-realm JWKS cache to the executor JWT verification middleware.
- [ ] On first encounter of an unknown issuer, fetch and cache the realm's JWKS.
- [ ] Validate `tenant_id` claim from the token and enforce cross-tenant scoping.

## Testing
- [ ] Black-box: create tenant → login as tenant owner → token contains `tenant_id`
  → use token to issue an API key → 201.
- [ ] Cross-tenant isolation: tenant-A token against tenant-B resource → 403.
- [ ] Run `bash tests/blackbox/run.sh`.
- [ ] Run `/opsx:verify fix-tenant-realm-token-issuance`.

## Archive
- [ ] `/opsx:archive fix-tenant-realm-token-issuance`
