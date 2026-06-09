# backup-restore Specification

## Purpose
Tenant-scoped backup and restore operations: snapshot listing, operation status, restore confirmation/abort, the confirmation-token model, and the backup-status authentication model.

## Requirements
### Requirement: Snapshot listing MUST enforce tenant scope for non-global callers

The system SHALL reject any snapshot listing request where the caller holds `backup-status:read:own` but the `tenant_id` query parameter does not match the authenticated actor's `token.tenantId`, returning HTTP 403 with no snapshot data disclosed.

#### Scenario: Own-scope caller cannot list another tenant's snapshots (bbx-snapshots-scope)

- **WHEN** an authenticated actor holding `backup-status:read:own` with `tenantId=ten_A` calls the list-snapshots endpoint with `tenant_id=ten_B`
- **THEN** the system returns HTTP 403 and does not return any snapshot records belonging to tenant B

#### Scenario: Own-scope caller can list their own snapshots

- **WHEN** an authenticated actor holding `backup-status:read:own` with `tenantId=ten_A` calls the list-snapshots endpoint with `tenant_id=ten_A`
- **THEN** the system returns HTTP 200 and the response body contains only snapshot records belonging to tenant A

### Requirement: Global-scope snapshot listing MUST be restricted to platform operators

The system SHALL verify that a caller presenting `backup-status:read:global` is a platform operator before listing snapshots for an arbitrary `tenant_id`; a tenant-scoped actor holding `:global` SHALL receive HTTP 403.

#### Scenario: Tenant-scoped actor with global scope is rejected

- **WHEN** an authenticated actor whose `actorType` is not `platform_operator` holds `backup-status:read:global` and calls the list-snapshots endpoint with a `tenant_id` value differing from `token.tenantId`
- **THEN** the system returns HTTP 403 and does not disclose any snapshot records for the requested tenant

#### Scenario: Platform operator with global scope can list any tenant's snapshots

- **WHEN** an authenticated platform-operator actor holding `backup-status:read:global` calls the list-snapshots endpoint with any valid `tenant_id`
- **THEN** the system returns HTTP 200 and the response body contains snapshot records for the requested tenant

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

### Requirement: Single-operation fetch MUST be tenant-scoped for non-global callers

The system SHALL include the authenticated actor's `tenant_id` as a predicate in the query that retrieves a single backup operation by ID for any caller that does NOT hold the platform-level `backup:read:global` scope, so that an operation record belonging to a different tenant is never returned to a tenant-scoped caller.

#### Scenario: Cross-tenant operation ID returns 404 not 403 (bbx-backup-op-idor)

- **WHEN** a tenant-scoped actor (no `backup:read:global`) for tenant A calls the get-operation endpoint with an operation ID that belongs to tenant B
- **THEN** the response is HTTP 404 and the response body does not reveal any detail about the cross-tenant operation, providing no existence signal to the caller

### Requirement: Backup operation access check MUST enforce tenant ownership before revealing existence

The system SHALL perform the tenant-scoped lookup before any access-control decision so that a missing tenant predicate cannot be exploited as an existence oracle distinguishing 404 (not found) from 403 (access denied) for tenant-scoped callers.

#### Scenario: Cross-tenant probe produces identical response to non-existent ID

- **WHEN** a tenant-scoped actor requests an operation ID that exists in the database but belongs to a different tenant
- **THEN** the system returns the same HTTP 404 response it would return for a non-existent ID, with no body field indicating the operation exists

### Requirement: backup:read:global is a platform-level read scope for single-operation fetch

The system SHALL treat `backup:read:global` as an explicitly-granted platform-level scope whose holder MAY read a single backup operation across tenants via an unscoped lookup; this scope is granted deliberately and is distinct from the per-tenant default. Callers without it remain tenant-scoped per the requirements above.

#### Scenario: Global read scope reads a cross-tenant operation

- **WHEN** an actor holding `backup:read:global` requests an operation ID belonging to a tenant other than the actor's own
- **THEN** the system performs an unscoped lookup and returns HTTP 200 with the operation body (the scope intentionally grants cross-tenant read)

#### Scenario: Non-existent operation returns 404 for a global reader

- **WHEN** an actor holding `backup:read:global` requests an operation ID that does not exist
- **THEN** the system returns HTTP 404

### Requirement: Restore confirmation MUST enforce tenant ownership unconditionally at the service layer

The system SHALL reject a restore confirmation request at the service layer whenever the acting actor's `tenantId` does not match the `tenantId` on the confirmation request, unless the actor holds a documented platform-level superadmin scope, regardless of whether `tenant_id` was supplied in the request body.

#### Scenario: Cross-tenant restore confirmation without tenant_id is rejected (bbx-confirm-restore-crosstenant)

- **WHEN** an actor authenticated for tenant B, holding `backup:restore:global`, calls the confirm-restore endpoint with a valid confirmation token belonging to a pending restore request for tenant A, and the request body does NOT include a `tenant_id` field
- **THEN** the system returns HTTP 403 and does not execute the restore, and no confirmation state change is written to the database

### Requirement: Restore confirmation action layer MUST treat tenant_id as a required field

The system SHALL require the `tenant_id` field in the confirm-restore request body and SHALL unconditionally reject requests where `body.tenant_id` does not match `token.tenantId` for non-superadmin callers, mirroring the behaviour of initiate-restore.

#### Scenario: Omitting tenant_id from confirm-restore body is rejected at the action layer

- **WHEN** a non-superadmin actor submits a confirm-restore request body that does not include a `tenant_id` field
- **THEN** the system returns HTTP 400 indicating that `tenant_id` is a required field

### Requirement: Tenant-name confirmation MUST NOT serve as the sole authorization boundary for restore

The system SHALL treat the `tenantNameConfirmation` field as a UX safety check only; tenant ownership authorization SHALL be enforced by a dedicated tenant identity check that precedes and is independent of the tenant-name string match.

#### Scenario: Knowing the target tenant name does not bypass the tenant ownership gate

- **WHEN** an actor belonging to tenant B submits a confirm-restore request with the correct `tenantNameConfirmation` string for tenant A's restore request, but with `tenant_id` set to tenant A's ID (not the actor's own tenant)
- **THEN** the system returns HTTP 403 before evaluating the tenant-name string, and the restore is not executed

### Requirement: Confirmation lookup MUST always hash the supplied token and MUST NOT accept a raw hash as a credential

The system SHALL compute a SHA-256 hash of any caller-supplied token string before performing the database lookup; the system SHALL NOT treat a 64-hex-character input as a pre-computed hash that bypasses the hash step.

#### Scenario: Supplying the stored token_hash directly is rejected as a credential (bbx-tokenhash-credential)

- **WHEN** a caller submits a confirm-restore request with `confirmation_token` set to the exact 64-hex-character SHA-256 hash of the original token (i.e. the value stored in the `token_hash` column), and the original random token is not supplied
- **THEN** the system returns HTTP 404 (confirmation request not found) and does not confirm, abort, or mutate the confirmation request in any way

#### Scenario: A valid random token still resolves and confirms the request

- **WHEN** a caller submits a confirm-restore request with `confirmation_token` set to the original random token that was issued at initiate time, and all other confirmation conditions are satisfied (same tenant, valid expiry, `confirmed: true`)
- **THEN** the system returns HTTP 202 and the restore is accepted normally

### Requirement: Internal abort MUST NOT pass the stored token_hash as a confirmation credential

The system SHALL provide an internal abort mechanism (`abortById` or equivalent) that accepts a confirmation request ID directly and does not route the stored `token_hash` through the public `findByTokenHash` lookup path.

#### Scenario: Internal abort by request ID succeeds without using the token_hash as a bearer token

- **WHEN** the system internally aborts a pending confirmation request using the request ID (not the token)
- **THEN** the abort is recorded in the database and the `token_hash` value is never compared against the caller-supplied bearer token string

#### Scenario: No code path passes request.tokenHash into a function expecting a bearer token

- **WHEN** the codebase is reviewed for all call sites of `findByTokenHash` and `confirm`
- **THEN** no call site passes a value sourced from `request.tokenHash` or `row.token_hash` into the `confirmationToken` parameter of `confirm` or the `tokenOrHash` parameter of `findByTokenHash`
