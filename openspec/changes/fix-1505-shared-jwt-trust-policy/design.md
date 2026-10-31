# Trust policy and rollout decision

## Diagnosis

Ranked falsifiable hypotheses were: (1) public/internal issuer mismatch, predicting rejection before JWKS lookup; (2) missing `in-falcone` audience, predicting rejection after issuer acceptance; (3) platform key lookup/signature mismatch, predicting failure even with issuer and audience accepted. The generated internal-issuer/account token passed the control plane and failed the executor's issuer check at base. A public-issuer/account HTTP token also returned 401 at base. Accepting explicit issuer aliases and explicit audience membership makes the same signed fixtures pass; per-realm signature and key-lookup negative cases remain rejected.

## Exact issuer bases

`trustedRealmBases` is an explicit array of canonical HTTP(S) URLs ending in `/realms/`, for example `https://identity.test/realms/` and `http://falcone-keycloak:8080/realms/`. Match an entire base followed by one literal realm segment. Reject wildcards, credentials, query strings, fragments, encoded or nested realm paths, and foreign hosts. The platform realm must agree with the configured issuer and realm-shaped JWKS URL. An explicit allowlist replaces derived trust: the internal JWKS host is never implicitly added.

All platform aliases use the configured platform JWKS URL and cache. Tenant JWKS endpoints are constructed only after classification under an allowlisted base. Tenant identity comes from the verified realm, overriding a forged `tenant_id`. The shared verifier passes its verified trust as an optional second revocation-hook argument; both real hooks use that realm for the existing tenant/client lookup and keep legacy standalone callers compatible. Platform and legacy service-account tokens remain fail-closed.

Without the new array settings, existing single-issuer configurations derive their one base as before. Bare-JWKS mode with no issuer retains legacy issuer/audience behavior. Signature, RSA algorithm restriction, exp/nbf and injected revocation checks still run. Public factory signatures and executor identity mapping remain compatible.

## Audience decision

Allow `account` only as an explicit rollout audience alongside `in-falcone` for verified platform-realm tokens. It is never a source default and never authorizes tenant-realm tokens when tenant audience enforcement is on. This deliberately accepts the existing console token shape while the deployment reconciles the console audience mapper and sessions refresh. It also admits other tokens with `account` from the same trusted platform realm; existing role and tenant/workspace gates still apply. `azp` never participates in audience validation.

Time box: the deployment/operator must remove `account` from `KEYCLOAK_PLATFORM_AUDIENCES` after the audience mapper is reconciled and existing access tokens refresh/expire, no later than 2026-11-14. Removal is a configuration rollout, not an automatic source-code deadline. The independent checker/operator must review this explicit compatibility decision. A strict deployment can configure only `["in-falcone"]` once the mapper is ready. Empty or malformed explicit arrays fail closed rather than disabling checks.

Tenant audience enforcement is shared by both verifiers. The deployment must ensure tenant app/console clients receive the configured tenant data-API audience before enabling that switch; the existing tenant audience provisioning/backfill mechanisms remain unchanged.

## Environment contract for the companion charts

Both runtime entry points use `jwtVerifierOptionsFromEnv` from the shared module.

| Environment variable | Meaning |
| --- | --- |
| `KEYCLOAK_JWKS_URL` | Configured platform JWKS URL; shared across platform aliases |
| `KEYCLOAK_ISSUER` | Primary exact platform issuer, normally the public URL |
| `KEYCLOAK_TRUSTED_REALM_BASES` | JSON array of exact URLs ending in `/realms/`; absent preserves single-base behavior |
| `KEYCLOAK_PLATFORM_REALM` | Optional platform realm; must match configured issuer/JWKS topology |
| `KEYCLOAK_AUDIENCE` | Existing single platform audience, used when the new array is absent |
| `KEYCLOAK_PLATFORM_AUDIENCES` | Non-empty JSON audience array, matched by exact `aud` membership |
| `KEYCLOAK_TENANT_AUDIENCE` | Existing tenant data-API audience |
| `KEYCLOAK_ENFORCE_TENANT_AUDIENCE` | Existing strict `true`/`false` switch |
| `KEYCLOAK_ALLOW_TENANT_REALMS` | Existing compatibility switch: `0` disables tenant realms |

The control plane retains its existing default internal JWKS URL; the executor retains its required-verifier startup gate. Deployment parity requires both workloads to receive the same explicit values from `in-falcone.issuerJwksAuth` through the existing `executor-jwt-config` ConfigMap, `workload.yaml` valueFrom guard, `executor-jwt-env-upgrade` migration and checksum annotations. No FALCONE_CHARTS_REF edit is made here. The chart maker must add/reconcile the platform console's `oidc-audience-mapper`, including existing realms, and test both deployment renders against this contract.

## Failure handling

A rejected JWT-shaped Bearer credential returns HTTP 401 with `code: INVALID_TOKEN`. Opaque invalid credentials, invalid API keys and missing identity retain `UNAUTHENTICATED: Missing tenant identity`. Existing API-key precedence, query API-key SSE handling and gateway proof behavior remain unchanged.

Each shared verification failure emits a JSON line with only `category`, `issHost` and `aud`. Categories are `malformed`, `alg`, `issuer`, `key_lookup`, `signature`, `expiry`, `nbf`, `audience`, `revoked`. Hosts/audiences are untrusted diagnostics, not identity. At most eight audience strings of at most 128 printable ASCII characters are logged; objects, control characters and token segments are redacted. Error causes and full claims are never forwarded to the log. Logger failure cannot change the denial.

## Rollback and operator checks

Revert source image and companion chart verifier configuration together. The additive audience mapper may remain. Operator checks after normal publication: superadmin lists flows/MCP; tenant owner lists only its workspace; existing realms have the mapper; both workloads have identical effective issuer/audience configuration. No live staging credentials or mutations are part of the maker task.
