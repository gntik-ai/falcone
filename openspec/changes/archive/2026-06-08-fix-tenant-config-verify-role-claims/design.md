## Context

The `tenant-config-*` OpenWhisk action family (migrate, validate, export, preflight, reprovision, export-domains, identifier-map) guards access by calling a local `extractAuth` helper that decodes the JWT payload segment via `JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))`. No signature check is performed. Claims read from this unverified payload — `realm_access.roles` and `scope` — are then used to assign `actor_type` (`superadmin`, `sre`, or `service_account`). This is the same unsigned-JWT antipattern as bug-001 (CDC capture actions) but grants a *role* rather than a data scope, making it more severe (privilege forgery). The correct patterns are already present in the codebase: `services/realtime-gateway/src/auth/token-validator.mjs` performs full JWKS verification; `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` uses gateway-injected trusted headers.

## Goals / Non-Goals

**Goals:**
- Ensure `actor_type` is never derived from an unverified JWT payload in any `tenant-config-*` action.
- An attacker who crafts a self-signed or unsigned JWT with elevated roles MUST receive a 403 before the action body is processed.
- Preserve the existing API contract; legitimate callers are not broken.
- Apply consistently to all seven `tenant-config-*.mjs` files in the action family.

**Non-Goals:**
- Changing the HTTP/OpenWhisk API surface (method, path, request/response shape).
- Implementing a general JWKS cache or shared auth middleware (that is a separate, broader effort); here we remove the insecure path and replace with the already-proven patterns.
- Addressing bug-001 (CDC capture actions) — that is a separate change.

## Decisions

1. **Preferred fix: trusted gateway headers** — if the APISIX gateway injects authoritative `x-actor-type`, `x-actor-id`, `x-actor-scopes` headers (analogous to `x-tenant-id`/`x-workspace-id` used by scheduling), these should be the sole source of identity. This is the simplest, most consistent approach and removes cryptographic complexity from the action layer. Confirm with gateway config before committing to this path.
2. **Fallback: JWKS verification** — if gateway headers are not authoritative for role/scope, implement JWKS-based signature verification (iss/aud/exp) before reading claims, reusing the `token-validator.mjs` JWKS client. The JWKS URL is already available via environment in adjacent services.
3. **Rejection semantics** — unverified tokens return 403 (not 401) to match the existing error message `'Forbidden: insufficient role or missing scope platform:admin:config:export'` and avoid leaking which check failed.
4. **Consistent application** — all seven files share the identical `extractAuth` function body; fix must be applied to all of them, not just `tenant-config-migrate.mjs`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Gateway headers may not carry `actor_type`/`actor_scopes` in the current routing config | Audit `services/gateway-config/base/public-api-routing.yaml` before choosing approach; fall back to JWKS if needed |
| JWKS client introduces a network call on every action invocation | Cache the JWKS keyset with a short TTL (60 s) using the pattern already in `token-validator.mjs` |
| Other `tenant-config-format-versions.mjs` or read-only actions may not need the same guard | Review each file; read-only metadata endpoints may warrant a lighter check, but the same verification principle applies |
| Test mocking of JWKS in the black-box suite | Use the `overrides.auth` DI escape hatch already present in both `main()` signatures — inject a verified auth object directly; do not bypass the real code path in the default branch |

## Migration Plan

1. Identify whether gateway already injects authoritative role/scope headers for these routes (read `services/gateway-config/`).
2. Write a failing `bbx-config-forged-superadmin` black-box test that presents an unsigned forged token and asserts 403.
3. Replace `extractAuth` in all seven files with the chosen verified approach.
4. Run `bash tests/blackbox/run.sh`; confirm `bbx-config-forged-superadmin` passes and no existing tests regress.
5. Archive the change.
