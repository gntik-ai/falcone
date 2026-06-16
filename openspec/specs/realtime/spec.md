# realtime Specification

## Purpose
TBD - created by archiving change fix-realtime-refresh-identity-stability. Update Purpose after archive.
## Requirements
### Requirement: refreshToken MUST reject tokens whose tenant does not match the session

The system SHALL verify that `claims.tenant_id` in the new Bearer token equals `session.tenantId` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch, without mutating any session state.

#### Scenario: Cross-tenant token rejected on refresh (bbx-refresh-tenant-drift)

- **WHEN** a caller invokes `refreshToken` for session S (created for tenant A, actor X) with a validly-signed token whose `tenant_id` is tenant B (a different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and the session's `tenant_id` and in-memory `claims.tenant_id` remain bound to tenant A (or the session is closed and no subsequent scope checks run under tenant B's identity)

### Requirement: refreshToken MUST reject tokens whose actor does not match the session

The system SHALL verify that `claims.sub` in the new Bearer token equals `session.actorIdentity` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch.

#### Scenario: Actor drift rejected on refresh

- **WHEN** a caller invokes `refreshToken` for session S (created for actor X in tenant A) with a validly-signed token whose `sub` is actor Y (a different actor, same or different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and no scope check or publish-guard for session S evaluates actor Y's claims

### Requirement: refreshToken MUST NOT mutate session identity anchors

The system SHALL ensure that after a successful `refreshToken` call the DB columns `tenant_id` and `actor_identity` for the session row remain equal to their values at session creation time, and `session.tenantId` and `session.actorIdentity` in memory remain unchanged.

#### Scenario: Successful refresh preserves session identity anchors

- **WHEN** a caller invokes `refreshToken` for session S with a validly-signed token that matches `session.tenantId` and `session.actorIdentity`
- **THEN** the session DB row `tenant_id` and `actor_identity` columns are unchanged, `session.tenantId` and `session.actorIdentity` in memory are unchanged, and the session status becomes `ACTIVE`

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

