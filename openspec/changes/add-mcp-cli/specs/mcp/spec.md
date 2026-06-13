## ADDED Requirements

### Requirement: The CLI scaffolds a runnable MCP server per language
The system SHALL provide a `falcone mcp init <language>` command that scaffolds a runnable MCP server for TypeScript, Python, or Go, and SHALL reject an unsupported language.

#### Scenario: init scaffolds a runnable server
- **WHEN** a user runs `falcone mcp init` for a supported language
- **THEN** a runnable MCP server project (entrypoint, manifest, run command) is produced for that language

#### Scenario: Unsupported language is rejected
- **WHEN** a user runs `falcone mcp init` for an unsupported language
- **THEN** the command fails with a clear error and a non-zero exit code

### Requirement: The CLI runs a local dev loop against the tenant context
The system SHALL provide a `falcone mcp dev` command that prepares a local run plus a tunnel and MCP Inspector bound to the caller's tenant and workspace.

#### Scenario: dev binds to the credential's tenant/workspace
- **WHEN** a user runs `falcone mcp dev` with a valid credential and workspace
- **THEN** the dev plan runs the server locally and exposes a tunnel and Inspector scoped to that tenant and workspace

### Requirement: The CLI deploys to the runtime and prints the endpoint
The system SHALL provide a `falcone mcp deploy` command that submits an image or source to the control-plane runtime within the caller's workspace and reports the resulting endpoint.

#### Scenario: deploy targets the credential workspace and prints the endpoint
- **WHEN** a user runs `falcone mcp deploy` with an image or source
- **THEN** the request is sent to the caller's workspace-scoped runtime route with the credential, and the endpoint is reported

### Requirement: The CLI authenticates with Falcone credentials and cannot cross tenants
The system SHALL authenticate CLI commands with the Falcone credential and SHALL refuse any command that attempts to target a tenant other than the credential's tenant.

#### Scenario: Unauthenticated command is rejected
- **WHEN** a credential-requiring command runs without a Falcone credential
- **THEN** it fails with a not-authenticated error and a non-zero exit code

#### Scenario: Cross-tenant target is refused
- **WHEN** a command is invoked targeting a tenant other than the credential's tenant
- **THEN** the command is refused
