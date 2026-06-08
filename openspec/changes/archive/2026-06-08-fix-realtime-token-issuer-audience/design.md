## Context

`createTokenValidator` in `services/realtime-gateway/src/auth/token-validator.mjs` relies on `jose`'s `jwtVerify` for local signature verification. `jwtVerify` accepts an optional third argument where `issuer` and `audience` can be supplied; if omitted, `jose` skips those checks entirely. The env module `services/realtime-gateway/src/config/env.mjs::loadEnv` defines `REQUIRED_STRING_KEYS` but does not include `KEYCLOAK_ISSUER` or `KEYCLOAK_AUDIENCE`, so the values are never validated at startup and never returned for use by the validator. In a shared JWKS scenario (multiple Keycloak clients or realms under one `.well-known/jwks.json`) any token signed by the same keypair — regardless of its intended audience — passes signature verification and is fully trusted by the realtime gateway. The reference implementation in `services/backup-status/src/api/backup-status.auth.ts:116-120` already demonstrates the correct pattern.

## Goals / Non-Goals

**Goals:**
- Enforce `iss` and `aud` on every locally-verified token in the realtime gateway.
- Add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` as required startup configuration.
- Match the already-established pattern in `backup-status`.

**Non-Goals:**
- Changing the introspection fallback path (active introspection already validates the token server-side).
- Addressing the distinct bug-005 session refresh identity drift (tracked separately as fix-realtime-refresh-identity-stability).
- Changing how JWKS keys are fetched or cached.

## Decisions

**Decision: Add both KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE to REQUIRED_STRING_KEYS.**
Rationale: An issuer with no audience check (or vice versa) still leaves a partial binding gap. Requiring both matches `backup-status` and closes the full claim-binding surface. Operators who deploy a single realm with a single client can always set both.

**Decision: Pass `issuer` and `audience` directly to `jwtVerify` rather than post-verifying claims manually.**
Rationale: `jose` performs the check as part of verification; post-verification manual checks have TOCTOU risk and duplicate logic already provided by the library.

**Alternative considered:** Make `KEYCLOAK_AUDIENCE` optional (matching `backup-status`'s `...(audience ? { audience } : {})`). Rejected for the realtime gateway: the gateway is a dedicated service with a fixed, known client; an absent audience is a misconfiguration, not a deployment flexibility. Requiring it is safer.

## Risks / Trade-offs

**Risk:** Deployments that currently rely on the absence of audience/issuer enforcement will break on upgrade.
**Mitigation:** This is a security fix; the breakage is intentional. Deployment runbooks must add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE`. Documented in Migration Plan.

**Risk:** If the introspection fallback is triggered after a local `TOKEN_INVALID` due to wrong issuer, the introspected token may also be rejected by Keycloak (since the token was minted for a different client). The error path is correct either way.
**Mitigation:** No code change needed; the fallback only triggers on key-not-found errors, not on issuer/audience mismatch.

## Migration Plan

1. Operators set `KEYCLOAK_ISSUER` to the Keycloak realm issuer URL (e.g., `https://auth.example.com/realms/falcone`) and `KEYCLOAK_AUDIENCE` to the realtime client ID (e.g., `falcone-realtime`).
2. The realtime-gateway pod/process is restarted; `loadEnv` will throw at startup if either variable is absent.
3. No schema or API changes; no client-side changes required (existing well-formed tokens from the correct realm/client continue to work).
