# fix-kind-control-plane-multirealm-jwt

## Change type
bugfix

## Capability
control-plane-runtime

## Priority
P2

## Why
On the kind stack, control-plane-served admin routes reject **tenant-realm** JWTs, so a tenant user
(e.g. `tenant_owner`) cannot use the control-plane admin API at all — `GET /v1/workspaces/{id}`,
`GET /v1/tenants/{id}/workspaces`, etc. return `401 INVALID_TOKEN`. GitHub issue #622 (related #527,
#515).

**Root cause (code-verified).** Falcone places each tenant in its OWN Keycloak realm whose name == the
tenant id (`deploy/kind/control-plane/b-handlers.mjs`: `realm = tenantId`). The hand-built kind
control-plane runtime `deploy/kind/control-plane/server.mjs` verified Bearer JWTs against a SINGLE
platform-realm JWKS: `const JWKS = createRemoteJWKSet(new URL(JWKS_URL))` (one URL, default
`…/realms/in-falcone-platform/protocol/openid-connect/certs`) and `jwtVerify(token, JWKS, opts)`. A
tenant-realm token (`iss = <base>/realms/<tenantId>`) is signed by that realm's keys, which are absent
from the platform JWKS, so verification fails with
`JWKSNoMatchingKey: no applicable key found … (ERR_JWKS_NO_MATCHING_KEY)` → `401 INVALID_TOKEN`.

The product executor (`apps/control-plane/src/runtime/jwt-verify.mjs`) was already made multi-realm
(`allowTenantRealms`, fetch each tenant realm's JWKS on demand, derive the tenant id from the verified
issuer — #527) and accepts the SAME token (e.g. `POST /v1/workspaces/{id}/api-keys` → 201). So the two
runtimes diverged and tenant self-service is broken on the kind dev/eval path; superadmin
(platform-realm) tokens still work, confirming the gap is specifically tenant-realm tokens.

## What Changes
- New `deploy/kind/control-plane/jwt-verify.mjs`: a dependency-free (`node:crypto` + JWKS over fetch)
  multi-realm verifier at parity with the executor's `jwt-verify.mjs`. It derives the Keycloak realms
  base from `JWKS_URL`/`ISSUER`, classifies a token's issuer (platform / per-tenant realm / outside =
  reject), fetches each realm's JWKS on demand (cached, with one rotation refetch), restricts the alg
  to RSA (rejects `alg:none` / HS* confusion), and enforces exp/nbf plus issuer+audience for the
  platform realm. It returns `{ payload, trust }` where `trust.realm` is the verified tenant id for a
  tenant-realm token.
- `deploy/kind/control-plane/server.mjs`: replace the single-realm `jose` `createRemoteJWKSet` /
  `jwtVerify` with `createMultiRealmVerifier`; in `authenticate()` take the tenant id from the
  cryptographically-verified issuer (`trust.realm`) for tenant-realm tokens (it cannot be forged by a
  `tenant_id` claim), falling back to the `tenant_id` claim for platform/legacy tokens. A
  `KEYCLOAK_ALLOW_TENANT_REALMS=0` escape hatch preserves single-realm behavior.
- `deploy/kind/control-plane/Dockerfile`: COPY the new `jwt-verify.mjs` (the image copies each module
  by name); the JWT path is now dependency-free, so `jose` is dropped from
  `deploy/kind/control-plane/package.json` (nothing else used it).

## Impact
- A verified tenant-realm JWT is accepted and authorized by the verified tenant/roles on
  control-plane-served routes (no `ERR_JWKS_NO_MATCHING_KEY`), matching the executor — tenant
  self-service works on the kind stack.
- A tenant-A token can never act as tenant B: the tenant id is the realm name from the verified
  issuer, not a forgeable claim.
- No change to platform/superadmin token handling or to the route/authorization contract.
- Affected specs: `control-plane-runtime`.
