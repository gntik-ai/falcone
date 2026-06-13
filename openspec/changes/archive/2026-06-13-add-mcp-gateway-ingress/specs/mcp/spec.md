## ADDED Requirements

### Requirement: MCP servers are reached only through the gateway over Streamable HTTP
The system SHALL expose hosted MCP servers to remote clients exclusively through the platform gateway over Streamable HTTP, and the gateway SHALL proxy a request only to the MCP server owned by the tenant resolved from the verified credential.

#### Scenario: Streamable-HTTP request is proxied to the tenant's server
- **WHEN** a client calls a hosted MCP server's endpoint with a valid token over Streamable HTTP
- **THEN** the gateway proxies it to that tenant's MCP-server workload and streams the response

#### Scenario: Cross-tenant routing is denied
- **WHEN** a client presents a token for tenant A and targets tenant B's MCP server
- **THEN** the gateway does not route the request to tenant B's server

### Requirement: The gateway enforces OAuth 2.1 and per-tool scopes for MCP
The gateway SHALL reject any MCP request without a valid OAuth 2.1 access token (`401`) and SHALL reject a tool call whose token lacks the tool's required scope (`403`), without falling back to client-supplied identity.

#### Scenario: Missing or invalid token
- **WHEN** an MCP request arrives without a valid OAuth 2.1 token
- **THEN** the gateway returns `401` and does not reach the server

#### Scenario: Insufficient per-tool scope
- **WHEN** a token lacks the scope required by the targeted tool
- **THEN** the gateway returns `403`

### Requirement: MCP gateway traffic is observable
The gateway SHALL emit a telemetry span for each MCP request carrying at least the tenant, server, and OAuth-client identifiers, fed into the platform's existing observability pipeline.

#### Scenario: Per-request span emitted
- **WHEN** an MCP request passes through the gateway
- **THEN** a span/log attributed to the tenant, server and OAuth client is recorded
