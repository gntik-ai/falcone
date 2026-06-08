# backup-restore Specification

## Purpose
TBD - created by archiving change fix-backup-testmode-shared-env. Update Purpose after archive.
## Requirements
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

