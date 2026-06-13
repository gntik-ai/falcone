## ADDED Requirements

### Requirement: The SDK injects tenant-scoped data clients into tool handlers
The system SHALL provide a server SDK that injects, into each tool handler, clients for the tenant's database, storage, functions, and events, pre-bound to the tenant and workspace resolved from the verified credential, so a tool reads or writes the tenant's data in a few lines.

#### Scenario: A tool reads the tenant database in a few lines
- **WHEN** a tool handler calls the injected database client
- **THEN** the request is automatically scoped to the credential's tenant and workspace

#### Scenario: Scope comes from the credential, not the tool arguments
- **WHEN** a tool is invoked
- **THEN** the injected clients are bound to the tenant resolved from the verified request, regardless of any tenant value in the tool arguments

### Requirement: A tool cannot escape its injected tenant scope
The system SHALL force the bound tenant and workspace onto every client request and SHALL expose no API to widen or change the injected scope, so a tool cannot access another tenant's data.

#### Scenario: Bound scope is authoritative on every call
- **WHEN** a tool passes tenant-looking values in its arguments or call data
- **THEN** the authoritative request scope remains the credential-bound tenant and workspace

#### Scenario: The injected context cannot be mutated
- **WHEN** a tool attempts to replace a client or change the scope on the injected context
- **THEN** the attempt has no effect (the context is immutable)

### Requirement: The SDK wraps the official MCP SDK in at least two languages
The system SHALL wrap the official MCP server SDK and SHALL be available for TypeScript and at least one of Python or Go.

#### Scenario: The SDK registers tools on an official MCP server
- **WHEN** a tool is declared through the SDK
- **THEN** it is registered on the underlying official MCP server with the tenant-scoped context injected
