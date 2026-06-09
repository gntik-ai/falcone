Realtime token validation omits issuer/audience binding

**Change ID:** fix-realtime-token-issuer-audience
**Capability:** realtime
**Type:** bug
**Priority:** P1 (High)
**OpenSpec change:** openspec/changes/fix-realtime-token-issuer-audience/

---

## Why

`verifyLocally` in `services/realtime-gateway/src/auth/token-validator.mjs` (line 161) calls `jwtVerifyFn(token, key, { clockTolerance: '5 seconds' })` with **only** clock tolerance — no `issuer` or `audience` constraints. Additionally, `services/realtime-gateway/src/config/env.mjs::loadEnv` never reads `KEYCLOAK_ISSUER` or `KEYCLOAK_AUDIENCE` from the environment, making enforcement impossible. Any RS256 token signed by a key present in the configured JWKS endpoint is accepted regardless of which client, realm, or audience it was minted for. In a realm-per-tenant or shared-realm Keycloak deployment, a token minted for a completely different client (admin console, CI service account, another tenant's client) is silently accepted by the realtime gateway. The correct pattern is already established in `services/backup-status/src/api/backup-status.auth.ts:116-120` which passes `issuer` and `audience` to `jwtVerify`.

## What Changes

- Add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` as required environment variables in `services/realtime-gateway/src/config/env.mjs::loadEnv`; both must be non-empty strings.
- Pass `{ issuer, audience, clockTolerance: '5 seconds' }` to `jwtVerifyFn` inside `verifyLocally`.
- Tokens whose `iss` or `aud` does not match the configured values are rejected with `TOKEN_INVALID`.
- No change to the introspection fallback path.

---

## Spec delta (EARS)

### Requirement: verifyLocally MUST enforce issuer binding on every token

The system SHALL pass the configured `KEYCLOAK_ISSUER` value as the `issuer` option to `jwtVerify` in `verifyLocally`; if the token's `iss` claim does not match, the system SHALL reject the token with `TOKEN_INVALID`.

#### Scenario: Token with wrong issuer is rejected (bbx-realtime-aud-binding)

- **WHEN** a caller presents a validly-signed RS256 token whose `iss` claim does not match `KEYCLOAK_ISSUER`
- **THEN** the realtime gateway rejects the token with an error code of `TOKEN_INVALID` and does not establish or refresh a session

### Requirement: verifyLocally MUST enforce audience binding on every token

The system SHALL pass the configured `KEYCLOAK_AUDIENCE` value as the `audience` option to `jwtVerify` in `verifyLocally`; if the token's `aud` claim does not include the expected audience, the system SHALL reject the token with `TOKEN_INVALID`.

#### Scenario: Token with wrong audience is rejected

- **WHEN** a caller presents a validly-signed RS256 token whose `aud` claim does not include the value of `KEYCLOAK_AUDIENCE`
- **THEN** the realtime gateway rejects the token with an error code of `TOKEN_INVALID` and does not establish or refresh a session

### Requirement: loadEnv MUST require KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE

The system SHALL fail startup with a descriptive error if `KEYCLOAK_ISSUER` or `KEYCLOAK_AUDIENCE` is absent or empty when `loadEnv` is called.

#### Scenario: Missing KEYCLOAK_ISSUER causes startup failure

- **WHEN** the realtime gateway starts with `KEYCLOAK_ISSUER` absent or empty
- **THEN** `loadEnv` throws an error naming the missing variable and the process does not proceed to serve requests

### Requirement: Tokens with matching issuer and audience MUST be accepted

The system SHALL accept a validly-signed RS256 token whose `iss` equals `KEYCLOAK_ISSUER` and whose `aud` includes `KEYCLOAK_AUDIENCE`, provided the token is not expired and the signature is valid.

#### Scenario: Valid token with correct issuer and audience is accepted

- **WHEN** a caller presents a validly-signed RS256 token with matching `iss` and `aud` claims and a valid expiry
- **THEN** the realtime gateway accepts the token and returns normalised claims

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-realtime-aud-binding` to `tests/blackbox/` that presents a validly-signed RS256 token whose `iss` does not match `KEYCLOAK_ISSUER` and asserts the validator returns `TOKEN_INVALID`
- [ ] 1.2 Add a companion assertion that presents a validly-signed token whose `aud` does not include `KEYCLOAK_AUDIENCE` and asserts the validator returns `TOKEN_INVALID`
- [ ] 1.3 Add an assertion that a validly-signed token with correct `iss` and `aud` is accepted (positive case)
- [ ] 1.4 Confirm all new assertions fail (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 In `services/realtime-gateway/src/config/env.mjs`, add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` to `REQUIRED_STRING_KEYS` and return both from `loadEnv` as validated non-empty strings
- [ ] 2.2 In `services/realtime-gateway/src/auth/token-validator.mjs::verifyLocally`, replace `{ clockTolerance: '5 seconds' }` with `{ issuer: env.KEYCLOAK_ISSUER, audience: env.KEYCLOAK_AUDIENCE, clockTolerance: '5 seconds' }`

### 3. Verify

- [ ] 3.1 Confirm `bbx-realtime-aud-binding` tests now pass (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-realtime-aud-binding**: presenting a validly-signed token whose `iss` differs from `KEYCLOAK_ISSUER` returns `TOKEN_INVALID`; presenting a validly-signed token whose `aud` does not include `KEYCLOAK_AUDIENCE` returns `TOKEN_INVALID`; presenting a validly-signed token with both correct returns success.

---

## Code evidence

- `services/realtime-gateway/src/auth/token-validator.mjs::verifyLocally` — line 161: `jwtVerifyFn(token, key, { clockTolerance: '5 seconds' })` — no `issuer` or `audience` option passed; `jose` skips both claim checks
- `services/realtime-gateway/src/config/env.mjs::loadEnv` — `REQUIRED_STRING_KEYS` array (lines 1-8): `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` are absent; returned env object (lines 86-104) does not include either key
- `services/backup-status/src/api/backup-status.auth.ts` — lines 116-120: reference implementation that correctly passes `...(issuer ? { issuer } : {})` and `...(audience ? { audience } : {})` to `jwtVerify`

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-realtime-token-issuer-audience` — implement the fix following tasks.md
2. `/opsx:verify fix-realtime-token-issuer-audience` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-realtime-token-issuer-audience` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-realtime-token-issuer-audience`

Optional real E2E: `/e2e-issue fix-realtime-token-issuer-audience`
