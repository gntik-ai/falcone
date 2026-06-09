## ADDED Requirements

### Requirement: Verified token identity for tenant-config actions

The system SHALL reject any request to a `tenant-config-*` action whose Bearer token cannot be cryptographically verified (signature, issuer, audience, and expiry checks all passing) before any role or scope claim is evaluated.

#### Scenario: Unsigned forged token with superadmin role is rejected

- **WHEN** a caller submits a request to `tenant-config-migrate` with a Bearer token whose payload claims `realm_access.roles: ["superadmin"]` and `scope: "platform:admin:config:export"` but whose signature is absent or invalid
- **THEN** the action MUST return HTTP 403 and MUST NOT grant `actor_type = 'superadmin'` or process the request body

#### Scenario: Unsigned forged token with sre role is rejected

- **WHEN** a caller submits a request to `tenant-config-validate` with an unsigned token payload claiming `realm_access.roles: ["sre"]`
- **THEN** the action MUST return HTTP 403 and MUST NOT assign `actor_type = 'sre'`

#### Scenario: Unsigned forged token with service_account scope is rejected

- **WHEN** a caller submits a request to `tenant-config-export` with an unsigned token claiming `scope: "platform:admin:config:export"` and `azp: "some-client"`
- **THEN** the action MUST return HTTP 403 and MUST NOT assign `actor_type = 'service_account'`

### Requirement: Legitimate verified tokens continue to be accepted

The system SHALL accept requests to `tenant-config-*` actions that carry a properly JWKS-verified token (or arrive with trusted gateway headers) bearing the `platform:admin:config:export` scope or recognised platform role.

#### Scenario: Valid JWKS-signed token with correct role is accepted

- **WHEN** a caller presents a valid, JWKS-signed Bearer token whose `realm_access.roles` includes `superadmin` and whose `iss`/`aud`/`exp` are all valid
- **THEN** the action MUST assign `actor_type = 'superadmin'` and proceed normally

#### Scenario: Missing token returns 403

- **WHEN** a request arrives at any `tenant-config-*` action with no Authorization header
- **THEN** the action MUST return HTTP 403 with an appropriate error message

### Requirement: No privilege derived from unverified payload

The system SHALL NOT evaluate `realm_access.roles`, `scope`, `azp`, or any other claim from a JWT payload before the token's cryptographic signature has been verified.

#### Scenario: Token with tampered payload is rejected even if structurally valid

- **WHEN** a caller presents a JWT whose header and signature correspond to a real token but whose payload has been replaced with an attacker-controlled base64url segment claiming elevated roles
- **THEN** the action MUST return HTTP 403 because signature verification fails over the tampered payload
