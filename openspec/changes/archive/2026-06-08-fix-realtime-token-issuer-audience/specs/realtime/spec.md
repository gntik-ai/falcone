## ADDED Requirements

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
