## Why

`verifyLocally` in `services/realtime-gateway/src/auth/token-validator.mjs` (line 161) calls `jwtVerifyFn(token, key, { clockTolerance: '5 seconds' })` with **only** clock tolerance — no `issuer` or `audience` constraints. Additionally, `services/realtime-gateway/src/config/env.mjs::loadEnv` never reads `KEYCLOAK_ISSUER` or `KEYCLOAK_AUDIENCE` from the environment, making it impossible to enforce these claims at all. The result is that any RS256 token signed by a key present in the configured JWKS endpoint is accepted regardless of which client, realm, or audience it was minted for. In a Keycloak deployment where a single JWKS endpoint serves multiple realms or clients (realm-per-tenant or shared realm with multiple clients), a token minted for a completely different audience — such as an admin console, a CI service account, or another tenant's client — is silently accepted by the realtime gateway. The correct pattern is already established in `services/backup-status/src/api/backup-status.auth.ts:116-120` which passes `issuer` and `audience` to `jwtVerify`.

## What Changes

- Add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` as required environment variables in `services/realtime-gateway/src/config/env.mjs::loadEnv`; both must be non-empty strings.
- Pass `{ issuer, audience, clockTolerance: '5 seconds' }` to `jwtVerifyFn` inside `verifyLocally` so that `jose` enforces the `iss` and `aud` claims on every locally-verified token.
- Tokens whose `iss` or `aud` does not match the configured values are rejected with `TOKEN_INVALID`.
- No change to the introspection fallback path — introspection is an active server check and its response is already trusted.

## Capabilities

### New Capabilities

- `realtime`: Token validation enforces issuer and audience binding; tokens minted for a different client, realm, or audience are rejected even if the signature is valid.

### Modified Capabilities

## Impact

- `services/realtime-gateway/src/auth/token-validator.mjs::verifyLocally` (line 161) — add `issuer`/`audience` to `jwtVerify` options
- `services/realtime-gateway/src/config/env.mjs::loadEnv` — add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` to `REQUIRED_STRING_KEYS` and return them
