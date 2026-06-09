## Context

`services/backup-status/src/api/backup-status.auth.ts` captures `IS_PRODUCTION = process.env.NODE_ENV === 'production'` and `IS_TEST_MODE = process.env.TEST_MODE === 'true'` at module load time (lines 31-32). The `validateToken` function refuses the combination `IS_PRODUCTION && IS_TEST_MODE` at both module-load (lines 77-79) and call-time (lines 83-86). For all other combinations (any non-production `NODE_ENV` with `TEST_MODE=true`) the function enters a branch at line 88 that parses `token.split('.')[1]` without signature verification and returns the claimed `sub`, `tenantId`, and `scopes`. An attacker on a staging or CI cluster with `TEST_MODE` accidentally or deliberately set can forge any scope, including `backup:restore:global` and `superadmin`, enabling the full cross-tenant attack surface described in bug-003 and bug-004. The existing `_setJwksOverride` mechanism (`_setJwksOverride` / `getJwks`) is the correct test-isolation pattern because it performs real signature verification against a locally-provided key set.

## Goals / Non-Goals

**Goals:**
- Ensure `TEST_MODE` cannot bypass authentication in any deployment that has a real JWKS URL configured.
- Preserve the `_setJwksOverride` unit-test mechanism which performs real verification.
- Minimise disruption to genuine isolated unit-test environments.

**Non-Goals:**
- Removing `TEST_MODE` entirely (it serves a legitimate isolated unit-test purpose when no real IdP is present).
- Changing the production guard (already correct).
- Addressing bug-003 or bug-004 directly (tracked as fix-backup-operation-fetch-idor and fix-confirm-restore-tenant-gate).

## Decisions

**Decision: Use `KEYCLOAK_JWKS_URL` presence as the "real IdP" signal rather than a new env var.**
Rationale: `KEYCLOAK_JWKS_URL` is already required for production verification; its presence is the most reliable available signal that the deployment is connected to a real identity provider. This requires no new configuration and cannot be forgotten.

**Decision: Fail with a 500 AuthError (misconfiguration) rather than silently falling through to the cryptographic path.**
Rationale: `TEST_MODE=true` with a real JWKS URL is always a misconfiguration. A loud 500 error at request time (and optionally at startup) surfaces the problem immediately rather than silently performing real verification — which would leave tests that rely on unsigned tokens broken in a confusing way.

**Alternative considered:** Silently ignore `TEST_MODE` when `KEYCLOAK_JWKS_URL` is set and fall through to full verification. Rejected: test suites that pass unsigned tokens would see silent 401s with no indication of why, making debugging harder. A loud 500 error is clearer.

## Risks / Trade-offs

**Risk:** CI pipelines that currently run against a real Keycloak (JWKS URL set) with `TEST_MODE=true` will begin returning 500 on auth calls.
**Mitigation:** This is intentional; such pipelines are already in a misconfigured state. They should switch to `_setJwksOverride` with a local key set or remove `TEST_MODE`.

**Risk:** A deployment that sets `KEYCLOAK_JWKS_URL` to a placeholder value in a purely offline environment would have `TEST_MODE` blocked.
**Mitigation:** A placeholder URL means the deployment intended to have a real IdP. Using `_setJwksOverride` is the correct pattern for offline testing.

## Migration Plan

1. Review all non-production deployments for `TEST_MODE=true`.
2. For deployments with `KEYCLOAK_JWKS_URL` set: remove `TEST_MODE` or switch to `_setJwksOverride`-based test fixtures.
3. For deployments without `KEYCLOAK_JWKS_URL` (fully isolated unit tests): no change needed.
4. No schema changes. No API surface changes. No client-side changes.
