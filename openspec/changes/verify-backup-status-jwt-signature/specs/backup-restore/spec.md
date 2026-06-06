## ADDED Requirements

### Requirement: Backup-status service verifies JWT cryptographic signature before trusting claims

The system SHALL validate every inbound JWT against the configured JWKS endpoint (`KEYCLOAK_JWKS_URL`) using a standard `jwtVerify` call before extracting `tenantId` or `scopes` from the token payload. The system SHALL reject tokens whose signature cannot be verified with a 401 response and SHALL NOT propagate any claims from an unverified token to downstream handlers.

#### Scenario: Forged token with valid expiry is rejected

- **WHEN** a caller presents a JWT whose payload contains a valid future `exp` and an arbitrary `tenant_id` but whose signature was not produced by the Keycloak private key
- **THEN** the system returns HTTP 401 before executing any handler logic
- **AND** no tenant-scoped data or operation result is returned to the caller

#### Scenario: Valid Keycloak-signed token is accepted

- **WHEN** a caller presents a JWT that was signed by the Keycloak instance whose public keys are served at `KEYCLOAK_JWKS_URL`, with a valid `exp` and correct issuer and audience
- **THEN** the system extracts `tenantId` and `scopes` from the verified payload and proceeds to the handler

### Requirement: Backup-status service verifies JWT issuer and audience

The system SHALL compare the `iss` claim of every inbound JWT against `KEYCLOAK_ISSUER` and the `aud` claim against `KEYCLOAK_AUDIENCE` as part of signature verification. The system SHALL reject with HTTP 401 any token whose `iss` or `aud` does not match the configured values.

#### Scenario: Token with mismatched issuer is rejected

- **WHEN** a caller presents a cryptographically valid JWT whose `iss` claim does not match `KEYCLOAK_ISSUER`
- **THEN** the system returns HTTP 401 before executing any handler logic

#### Scenario: Token with correct issuer and audience is accepted

- **WHEN** a caller presents a JWT with a matching `iss`, matching `aud`, and a valid signature
- **THEN** the system proceeds to scope and tenant authorization

### Requirement: TEST_MODE bypass is blocked in production

The system SHALL NOT allow `TEST_MODE=true` to bypass JWT verification when `NODE_ENV` is set to `production`. The system SHALL fail with a startup or request-level error if `TEST_MODE=true` is detected alongside `NODE_ENV=production`.

#### Scenario: TEST_MODE is rejected in production environment

- **WHEN** the backup-status service starts or handles a request with `NODE_ENV=production` and `TEST_MODE=true`
- **THEN** the system returns an error or refuses to start, preventing any authentication bypass
- **AND** no handler processes the request using the test-mode shortcut path
