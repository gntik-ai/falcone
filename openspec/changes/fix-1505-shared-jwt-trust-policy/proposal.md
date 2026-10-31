# Shared JWT trust policy for console sessions

## Problem and confirmed cause

At immutable source base `b694e45e487b1c49238e30a544fb7076fc18a7d6`, a generated RSA-signed platform token with issuer `http://falcone-keycloak:8080/realms/in-falcone-platform` and audience `account` verifies in the deployed control-plane configuration but fails in the executor with `issuer not trusted`. The executor trusts only the public issuer base and requires `in-falcone`; the control plane derives its issuer base from the internal JWKS URL and has no audience requirement. The executor then hides verification failures behind `UNAUTHENTICATED: Missing tenant identity`, before the #1492 platform workspace substitution can run.

Before modifying source, run `node --test --experimental-test-isolation=none tests/unit/jwt-trust-policy-parity.test.mjs`: its first regression verified the token with the deployed control-plane configuration, then failed on the executor issuer check. Test isolation is disabled because this sandbox cannot execute Node test worker subprocesses. No real tokens or credentials were used or saved.

The HTTP regression was also run against an extracted immutable base, with only the new test and existing dependency links added: `node --test --experimental-test-isolation=none /tmp/falcone-1505-base/tests/unit/executor-console-jwt-routes.test.mjs`. Both flows and MCP requests returned 401 instead of 200 for the public and internal console issuer shapes; invalid JWTs returned `UNAUTHENTICATED` instead of `INVALID_TOKEN`. This diagnostic run is not a final-commit test result.

## Scope

Share issuer classification, audiences, cryptographic verification, tenant-audience enforcement, failure categories and environment parsing under `packages/internal-contracts/src/jwt-trust-policy.mjs`. Preserve the existing verifier entry points and executor identity/actor mapping. Keep service-account revocation tenant-scoped using the verifier's signed trust result. Return a distinct executor JWT failure code and emit one bounded diagnostic containing only category, issuer host and audiences.

The source maker changes no console UI, roles, grant type, public routing, workflow chart pins or deployment state. The separate deployment ChangeSet must supply identical verifier environment values, the console audience mapper, upgrade migration and rollout checksums through its existing guarded ConfigMap path. Its render/provisioning tests remain deployment-repository responsibilities.

## Public test seams

- Both existing verifier factories: generated token corpus, exact issuer allowlisting, per-realm keys, accepted audiences, expiry/nbf, algorithms, signature, key lookup, revocation and failure-category parity.
- Executor HTTP parser/server: signed superadmin tokens without tenant claims reach flows and MCP list routes; verified tenant identity cannot cross workspace ownership; invalid JWTs and opaque credentials retain distinct errors.
- Injected logger: failure lines contain only bounded category/host/audience data, with no token segments, signatures, claims objects, control characters or arbitrary audience objects.
- Existing identity/API-key/gateway/SSE and workspace-binding suites: preserve credential precedence and authorization gates.

## Limits

This source change requires the companion chart configuration before deployed issuer/audience parity is achieved. Image builds, chart render/provisioning tests and real-session staging checks are owned by PR/release CI and the operator. The supplied control-plane risk is R1; the issue's authentication-wide R3 concern should be assessed by the independent checker/operator. The maker does not approve, merge or deploy.
