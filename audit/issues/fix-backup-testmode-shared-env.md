backup-status TEST_MODE accepts unsigned tokens outside production

**Change ID:** fix-backup-testmode-shared-env
**Capability:** backup-restore
**Type:** bug
**Priority:** P1 (High)
**OpenSpec change:** openspec/changes/fix-backup-testmode-shared-env/

Relates to #205 (verify-backup-status-jwt-signature) — that fix added signature verification and a production TEST_MODE block only; the non-production TEST_MODE bypass (shared staging/CI clusters) remains. Consider reopening #205.

---

## Why

`validateToken` in `services/backup-status/src/api/backup-status.auth.ts` (lines 82-102) contains a `TEST_MODE` path that parses `token.split('.')[1]` as a base64url-encoded JSON payload with **no signature verification** and returns the self-asserted `sub`, `tenantId`, and `scopes` claims verbatim. The only guard is `NODE_ENV === 'production'`: the combination `IS_PRODUCTION && IS_TEST_MODE` is blocked at module load (lines 77-79) and at call time (lines 83-86). Any deployment where `TEST_MODE=true` and `NODE_ENV` is anything other than `"production"` — including `staging`, `ci`, `test`, or unset — executes the unsigned-payload path. A non-production cluster shared with real or simulated tenants (common in staging/CI) accepts fully-forged tokens carrying arbitrary `scopes` such as `backup:restore:global` or `superadmin`, bypassing all authentication and directly compounding the cross-tenant risk of bug-003 and bug-004.

## What Changes

- Before entering the `TEST_MODE` unsigned-payload branch, add a guard: if `KEYCLOAK_JWKS_URL` is set to a non-empty value, throw `AuthError(500, ...)` regardless of `NODE_ENV`.
- `KEYCLOAK_JWKS_URL` presence is the reliable signal that the deployment is connected to a real IdP and is therefore not a fully isolated unit-test environment.
- `TEST_MODE` without `KEYCLOAK_JWKS_URL` (truly offline unit tests) continues to work.
- The `_setJwksOverride` injection mechanism is unaffected.

---

## Spec delta (EARS)

### Requirement: validateToken MUST block TEST_MODE when a real JWKS URL is configured

The system SHALL refuse to accept unsigned tokens via the `TEST_MODE` path whenever `KEYCLOAK_JWKS_URL` is set to a non-empty value; under this condition the system SHALL throw an `AuthError` with status 500 rather than parsing the token payload without signature verification.

#### Scenario: TEST_MODE with real JWKS URL is rejected (bbx-backup-testmode-bypass)

- **WHEN** `TEST_MODE=true` and `KEYCLOAK_JWKS_URL` is set to a non-empty value and `NODE_ENV` is not `production`
- **THEN** `validateToken` throws an `AuthError` with status 500 and does not return claims parsed from an unsigned token payload

### Requirement: validateToken MUST block TEST_MODE with forged scopes in non-production

The system SHALL reject a request that presents a token with no valid signature and self-asserted `scopes` including `backup:restore:global` or `superadmin` in any deployment where a real JWKS URL is configured.

#### Scenario: Forged superadmin scope is rejected in staging

- **WHEN** `TEST_MODE=true`, `NODE_ENV=staging`, `KEYCLOAK_JWKS_URL` is non-empty, and a caller presents an unsigned token payload claiming `scopes: ["superadmin"]`
- **THEN** `validateToken` returns an error and does not grant the claimed scopes to the caller

### Requirement: validateToken MUST still accept TEST_MODE when no real JWKS URL is configured

The system SHALL permit the unsigned-payload `TEST_MODE` path only when `KEYCLOAK_JWKS_URL` is absent or empty, reflecting a fully isolated unit-test environment with no real IdP.

#### Scenario: TEST_MODE accepted in isolated unit-test environment

- **WHEN** `TEST_MODE=true`, `NODE_ENV` is not `production`, and `KEYCLOAK_JWKS_URL` is absent or empty
- **THEN** `validateToken` parses the token payload without signature verification and returns the claimed sub, tenantId, and scopes

### Requirement: _setJwksOverride MUST remain functional for unit tests

The system SHALL continue to accept the `_setJwksOverride` injection path for unit tests that supply a local key set; this path performs signature verification and is not affected by the TEST_MODE guard.

#### Scenario: Unit test with JWKS override still validates tokens

- **WHEN** `_setJwksOverride` is set to a local JWK set and `TEST_MODE` is not set
- **THEN** `validateToken` uses the injected key set to verify the token signature and returns claims on success

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-backup-testmode-bypass` to `tests/blackbox/` that, with `TEST_MODE=true`, `NODE_ENV=staging`, and `KEYCLOAK_JWKS_URL` set to a non-empty value, presents an unsigned token payload claiming `scopes: ["superadmin"]` and asserts the call returns an `AuthError` (not a valid claims object)
- [ ] 1.2 Add a companion assertion that verifies the same scenario with `scopes: ["backup:restore:global"]` is also rejected
- [ ] 1.3 Add a positive assertion: with `TEST_MODE=true`, `NODE_ENV=test`, and `KEYCLOAK_JWKS_URL` absent, the unsigned-payload path is still accepted (isolated unit-test environment)
- [ ] 1.4 Confirm the rejection assertions fail (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 In `services/backup-status/src/api/backup-status.auth.ts::validateToken`, before entering the `if (testMode)` branch, add a guard: if `process.env.KEYCLOAK_JWKS_URL` is a non-empty string, throw `new AuthError(500, 'TEST_MODE is not permitted when KEYCLOAK_JWKS_URL is configured')`
- [ ] 2.2 Ensure the new guard is applied at call time (not only at module load) so that test environments that set env vars after module load are also covered

### 3. Verify

- [ ] 3.1 Confirm `bbx-backup-testmode-bypass` tests now pass (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-backup-testmode-bypass**: with `TEST_MODE=true`, `NODE_ENV=staging`, `KEYCLOAK_JWKS_URL` non-empty, presenting an unsigned token with `scopes: ["superadmin"]` returns an `AuthError` (status 500) and does NOT return a claims object granting `superadmin`. With `TEST_MODE=true`, `KEYCLOAK_JWKS_URL` absent, presenting an unsigned token returns valid claims (isolated test environment still works).

---

## Code evidence

- `services/backup-status/src/api/backup-status.auth.ts::validateToken` — lines 82-102: `if (testMode)` branch at line 88 enters unsigned-payload path; guard at lines 83-86 only blocks `isProd && testMode`, leaving all other `NODE_ENV` values unprotected
- `services/backup-status/src/api/backup-status.auth.ts` — lines 31-32: `IS_PRODUCTION = process.env.NODE_ENV === 'production'`; `IS_TEST_MODE = process.env.TEST_MODE === 'true'` — no check on `KEYCLOAK_JWKS_URL`
- `services/backup-status/src/api/backup-status.auth.ts` — lines 90-98: self-asserted `sub`, `tenantId`, `scopes` returned verbatim from unsigned payload; `scopes: ["backup:restore:global"]` or `["superadmin"]` accepted when guard passes

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-backup-testmode-shared-env` — implement the fix following tasks.md
2. `/opsx:verify fix-backup-testmode-shared-env` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-backup-testmode-shared-env` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-backup-testmode-shared-env`

Optional real E2E: `/e2e-issue fix-backup-testmode-shared-env`
