# backup-restore Specification

## Purpose
TBD - created by archiving change verify-backup-status-jwt-signature. Update Purpose after archive.
## Requirements
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

### Requirement: Restore target tenant must match the authenticated caller's tenant

The system SHALL compare `body.tenant_id` in every restore-initiate and restore-confirm request to the `tenantId` extracted from the verified JWT. The system SHALL return HTTP 403 when `body.tenant_id` does not equal `token.tenantId`, unless the caller's verified scopes include a platform-level cross-tenant privilege (e.g. `superadmin`). The system SHALL NOT initiate or confirm a restore for a tenant other than the authenticated caller's tenant.

#### Scenario: Tenant A cannot initiate a restore for tenant B

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-initiate endpoint with `body.tenant_id` set to tenant B
- **THEN** the system returns HTTP 403 before queuing or initiating any restore operation
- **AND** no restore record for tenant B is created

#### Scenario: Tenant A cannot confirm a restore for tenant B

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-confirm endpoint for a restore request that belongs to tenant B
- **THEN** the system returns HTTP 403 before executing any confirmation or destructive data operation
- **AND** tenant B's data is unchanged

#### Scenario: Tenant A can initiate a restore for tenant A

- **WHEN** a caller presents a valid JWT for tenant A and calls the restore-initiate endpoint with `body.tenant_id` set to tenant A
- **THEN** the system proceeds with restore initiation for tenant A

### Requirement: Confirmation status lookup is scoped to the authenticated caller's tenant

The system SHALL assert that the `tenantId` on a restore request matches the authenticated caller's `tenantId` before returning status or allowing confirmation to proceed. The system SHALL return HTTP 403 when `actor.tenantId` does not match `request.tenantId`, unless the caller holds a verified platform-level cross-tenant privilege.

#### Scenario: Status lookup for another tenant's restore request is rejected

- **WHEN** a caller with `actor.tenantId` equal to tenant A calls `ConfirmationsService.getStatus` for a restore request whose `tenantId` is tenant B
- **THEN** the system returns HTTP 403 and does not reveal any details of tenant B's restore request

### Requirement: Tenant-name confirmation gate requires an authoritative resolver

The system SHALL NOT resolve a tenant name by returning the raw `tenantId` string. The system SHALL require a wired, authoritative resolver for `resolveTenantName` and SHALL fail safely (return an error) if no resolver is configured. The destructive-action confirmation gate SHALL compare `body.tenantNameConfirmation` only to the resolved authoritative name, not to the raw tenant identifier.

#### Scenario: Confirmation with raw tenant id is rejected when resolver is wired

- **WHEN** an authoritative resolver is configured and the resolved tenant name differs from the raw `tenantId` string
- **AND** a caller submits `tenant_name_confirmation` equal to the raw `tenantId`
- **THEN** the system returns HTTP 422 and does not proceed with the destructive operation

#### Scenario: Confirmation fails safely when no resolver is configured

- **WHEN** `resolveTenantName` is called with no resolver wired
- **THEN** the system returns an error instead of echoing back the raw `tenantId`
- **AND** the confirmation gate is not satisfied

