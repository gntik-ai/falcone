## ADDED Requirements

### Requirement: MCP server detail surfaces endpoint, version and curated tools
The system SHALL present, for a published MCP server, its endpoint, status, active version, and the curated list of tools the server exposes.

#### Scenario: Detail shows endpoint, version and tools
- **WHEN** a tenant opens a published MCP server's detail page
- **THEN** the endpoint, the active version, and the curated tool list are shown

### Requirement: Connect tab renders one-click and copy-paste client configuration
The system SHALL render, in a Connect tab, a one-click "Add to Cursor" deeplink and copy-paste configuration snippets for Claude Code, claude.ai custom connectors, and VS Code, all targeting the server's Streamable-HTTP endpoint without embedding a static secret.

#### Scenario: Cursor deeplink and client snippets are available
- **WHEN** a tenant opens the Connect tab of a server with a published endpoint
- **THEN** a Cursor install deeplink and Claude Code, claude.ai, and VS Code configuration snippets are rendered for that endpoint

#### Scenario: No static secret is embedded
- **WHEN** the connect snippets are rendered
- **THEN** none contains a static secret and each indicates that authentication uses the tenant's OAuth flow

### Requirement: Playground invokes a tool through the OAuth flow and shows the result
The system SHALL let a tenant invoke a curated tool from a playground by supplying JSON arguments, sending an authenticated tool call through the tenant's OAuth flow, and SHALL display the structured result; it SHALL refuse to build a call without a valid access token or endpoint.

#### Scenario: A tool call returns a structured result
- **WHEN** a tenant invokes a curated tool with valid JSON arguments from the playground
- **THEN** the call is sent authenticated with the tenant's access token and the structured result is displayed

#### Scenario: A call cannot be made without authentication
- **WHEN** a tool call is built without a valid OAuth access token
- **THEN** the call is refused
