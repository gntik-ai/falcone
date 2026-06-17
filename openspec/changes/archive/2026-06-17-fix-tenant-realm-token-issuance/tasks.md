# Tasks — fix-tenant-realm-token-issuance

## Investigation
- [x] Intended token path: MULTI-REALM JWKS on the executor (not token exchange). Falcone places
  each tenant in its own realm whose NAME == the tenant id (`deploy/kind/control-plane/b-handlers.mjs`
  `realm = tenantId`), so the executor can trust tenant realms under the same Keycloak base and derive
  the tenant id from the verified issuer — un-forgeable.
- [x] Tenant creation handler: `deploy/kind/control-plane/b-handlers.mjs::createTenant` (durable saga);
  realm provisioning via `kc-admin.mjs`. Executor JWT verification: `apps/control-plane/src/runtime/jwt-verify.mjs`.

## Implementation (tenant realm provisioning)
- [x] Added a `createTenantAppClient` saga step: provisions a public `<slug>-app` client
  (ROPC + standard flow) in the tenant realm (`kc-admin.createPublicAppClient`). No separate
  compensation — createRealm's compensation deletes the realm (and the client within it).
- [x] Added a HARDCODED `tenant_id` claim mapper (`kc-admin.addHardcodedClaimMapper`,
  oidc-hardcoded-claim-mapper) with value = the tenant id (== realm name), so tokens carry an
  un-forgeable tenant_id regardless of user attributes (no dependency on A4 unmanaged attributes).

## Implementation (executor JWKS)
- [x] `createJwtVerifier` now derives the trusted Keycloak realms-base from the issuer/jwks URL and
  keeps a per-issuer JWKS cache; on an unknown (but trusted-base) issuer it fetches that realm's
  certs and caches them. Backward compatible (no base + no issuer → legacy accept-any).
- [x] For a tenant realm the tenant id is taken from the VERIFIED issuer (realm name), overriding any
  claim — so a tenant-A token cannot act as tenant B; issuers outside the base are rejected. The
  per-resource tenant scoping downstream (existing 403 guards + P0 fix) enforces cross-tenant isolation.

## Testing
- [x] Black-box (executor verifier, real RSA/JWKS, two realms):
  `tests/blackbox/tenant-realm-token-issuance.test.mjs` — platform token accepted; tenant-realm token
  accepted with tenant_id from the realm; forged tenant_id claim overridden; untrusted issuer rejected;
  cross-realm-signed token rejected. Existing `tests/unit/control-plane-jwt-verify.test.mjs` (8) still green.
- [x] End-to-end against real Keycloak 26 (tests/env): the REAL kc-admin provisioning created the
  realm + `<slug>-app` client + tenant_id mapper + owner; ROPC login produced a token with
  iss=.../realms/<tenantId> and tenant_id=<tenantId>; the multi-realm verifier accepted it and derived
  tenantId=<tenantId> (realm_bound_tenant_id_matches=true). (The cross-tenant→403 and api-key→201 HTTP
  scenarios follow from the derived tenantId + the existing resource-scoping/P0 fix.)
- [x] `bash tests/blackbox/run.sh` → 663/663.

## Archive
- [ ] `/opsx:archive fix-tenant-realm-token-issuance`
