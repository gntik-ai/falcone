# Tasks — fix-kind-control-plane-multirealm-jwt

## Reproduce (test-first)
- [x] Added a failing black-box test
  (`tests/blackbox/kind-control-plane-multirealm-jwt.test.mjs`, bbx-622-01..08) that mints RS256
  tokens for the platform realm AND a per-tenant realm (distinct keys, JWKS via an injected fetch
  stub) and asserts: a tenant-realm token verifies with the tenant id taken from the verified issuer;
  a forged `tenant_id` claim cannot override it; the tenant realm JWKS is fetched on demand; an issuer
  outside the base, a wrong-realm-key signature, `alg:none`, and a tampered signature are all
  rejected — failing while the runtime had no such verifier.

## Implement
- [x] New `deploy/kind/control-plane/jwt-verify.mjs`: dependency-free multi-realm verifier
  (`createMultiRealmVerifier`, `deriveRealmTopology`) returning `{ payload, trust }`.
- [x] `deploy/kind/control-plane/server.mjs`: use the multi-realm verifier; derive tenant id from the
  verified issuer (`trust.realm`) for tenant-realm tokens; `KEYCLOAK_ALLOW_TENANT_REALMS=0` escape
  hatch.
- [x] `deploy/kind/control-plane/Dockerfile`: COPY `jwt-verify.mjs`; `deploy/kind/control-plane/package.json`:
  drop the now-unused `jose` dependency (JWT path is dependency-free).

## Verify
- [x] New black-box test passes (8/8); `node --check` on both modules; no dangling `jose`/`jwtVerify`
  references; `bash tests/blackbox/run.sh` green (no regressions).
- [ ] Acceptance: on the kind stack a `tenant_owner` tenant-realm token gets `200` on
  `GET /v1/workspaces/{id}` (was `401 INVALID_TOKEN`), matching the executor (real-stack verification).

## Archive
- [ ] `openspec validate fix-kind-control-plane-multirealm-jwt --strict`; archive after merge.
