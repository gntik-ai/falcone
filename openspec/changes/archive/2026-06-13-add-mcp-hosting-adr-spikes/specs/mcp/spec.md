## ADDED Requirements

### Requirement: MCP hosting runtime is per-tenant and internal-only
The system SHALL host each tenant's MCP server inside that tenant's own Kubernetes namespace, and the runtime control plane (operator/controller) and the servers themselves SHALL NOT be reachable from another tenant's namespace or from tenant-facing traffic paths except through the platform's MCP gateway.

#### Scenario: Cross-namespace probe is denied
- **WHEN** a workload in tenant B's namespace attempts to reach an MCP server running in tenant A's namespace directly
- **THEN** the connection is refused by NetworkPolicy and no MCP response is returned

#### Scenario: Runtime control plane is not tenant-exposed
- **WHEN** a tenant attempts to reach the MCP runtime operator/controller endpoints over a tenant-facing path
- **THEN** the request does not resolve to the runtime control plane

### Requirement: Remote MCP transport is Streamable HTTP through the platform gateway
The system SHALL expose remote MCP servers only over Streamable HTTP via the platform's internal gateway, and SHALL NOT expose stdio transport for remote access (stdio is local-development only).

#### Scenario: Remote client connects over Streamable HTTP
- **WHEN** an MCP client connects to a hosted server's published endpoint
- **THEN** the connection is served over Streamable HTTP through the gateway

#### Scenario: stdio is not a remote transport
- **WHEN** a remote client attempts to use stdio transport against a hosted server
- **THEN** no remote stdio endpoint is available

### Requirement: Remote MCP access requires OAuth 2.1 scoped tokens
The system SHALL require a valid OAuth 2.1 access token, issued by the tenant's Authorization Server, to call a hosted MCP server, and SHALL enforce per-tool scopes. A presented-but-invalid or insufficiently-scoped token MUST be rejected and MUST NOT fall back to client-supplied identity.

#### Scenario: Missing or invalid token is rejected
- **WHEN** a client calls a hosted MCP server without a valid token
- **THEN** the gateway returns 401 and the call does not reach the server

#### Scenario: Tool call without the tool's scope is rejected
- **WHEN** a client presents a token lacking the scope required by a specific tool
- **THEN** the call to that tool returns 403

### Requirement: Instant-MCP generation requires mandatory curation before publish
The system SHALL route every auto-generated tool set through a mandatory curation step (enable/disable, description rewrite, scope assignment) before it can be published, and SHALL NOT serve an un-curated, auto-generated server to clients.

#### Scenario: Un-curated generated server cannot be connected
- **WHEN** Instant MCP is toggled on and a draft tool manifest is generated but not yet published through curation
- **THEN** no connectable endpoint serves those tools

#### Scenario: Curated server is publishable
- **WHEN** a tenant prunes tools, rewrites descriptions, assigns scopes, and publishes
- **THEN** only the curated, published tool set is served

### Requirement: MCP hosting is stateless with scale-to-zero for idle servers
The system SHALL implement MCP request handling against the stateless protocol core, and idle tenant MCP servers SHALL scale to zero and cold-start on demand without losing the ability to serve subsequent requests.

#### Scenario: Idle server scales to zero
- **WHEN** a hosted MCP server receives no traffic for the configured idle period
- **THEN** it scales to zero and consumes no running compute

#### Scenario: Scaled-to-zero server cold-starts on demand
- **WHEN** a client calls a server that has scaled to zero
- **THEN** the server cold-starts and serves the request

### Requirement: MCP servers, tools, logs and credentials are tenant-isolated
The system SHALL scope every MCP server, its tools, its execution logs/audit, and its OAuth clients/credentials to the owning tenant, such that one tenant can never enumerate or access another tenant's MCP servers, tools, logs or credentials.

#### Scenario: Tenant cannot enumerate another tenant's servers
- **WHEN** tenant A lists or queries MCP servers, tools, logs, or OAuth clients
- **THEN** only tenant A's resources are returned and tenant B's are never disclosed
