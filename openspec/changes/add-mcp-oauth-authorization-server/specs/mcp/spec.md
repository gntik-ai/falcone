## ADDED Requirements

### Requirement: The tenant's Authorization Server issues per-tool-scoped tokens
The system SHALL represent each curated MCP tool as a scope in the tenant's OAuth 2.1 Authorization Server, and a token issued to an authorized MCP client SHALL carry the scopes for the tools that client is permitted to call.

#### Scenario: Issued token carries the per-tool scope
- **WHEN** an authorized MCP client obtains a token for a tool it is permitted to call
- **THEN** the token's scope claim includes that tool's scope

#### Scenario: Tool scope absent when not granted
- **WHEN** a client is not granted a tool's scope
- **THEN** tokens issued to that client do not carry that tool's scope

### Requirement: MCP client registration is curated through Falcone
The system SHALL register MCP OAuth clients through the platform's own API (tenant-scoped, plan-limited), validate that redirect URIs are HTTPS, and SHALL NOT expose the raw Keycloak admin or dynamic-client-registration endpoints to tenants.

#### Scenario: Non-HTTPS redirect URI is rejected
- **WHEN** an MCP client is registered with a non-HTTPS redirect URI
- **THEN** registration is rejected with a validation error

#### Scenario: Registration is tenant-scoped and curated
- **WHEN** a tenant registers an MCP client
- **THEN** the client is created in that tenant's realm via the platform, without the tenant accessing Keycloak admin directly

### Requirement: MCP authorization supports consent and token revocation
The system SHALL present and record end-user consent when an MCP client is authorized, and SHALL allow a tenant to revoke an MCP client's tokens such that revoked tokens are no longer accepted.

#### Scenario: Consent is recorded
- **WHEN** an end-user authorizes an MCP client for a set of tool scopes
- **THEN** the consent is presented and recorded for that (user, client, scopes)

#### Scenario: Revoked token is rejected
- **WHEN** a tenant revokes an MCP client and the client presents a previously issued token
- **THEN** the token is rejected
