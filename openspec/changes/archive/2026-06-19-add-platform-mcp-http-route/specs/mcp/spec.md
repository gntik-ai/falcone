# mcp — spec delta for add-platform-mcp-http-route

## ADDED Requirements

### Requirement: Platform MCP server is reachable over HTTP (JSON-RPC)

The system SHALL expose the platform (first-party) MCP server over an authenticated HTTP JSON-RPC
endpoint (`POST /v1/mcp/rpc`) so a standard MCP client can `initialize`, `tools/list`, and
`tools/call` the official Falcone management tools. The endpoint SHALL require an authenticated
caller (no trusted identity → `401`). The tenant SHALL be derived from the verified credential and
NEVER from tool arguments. A `tools/call` SHALL be authorized from the caller's verified token
scopes — the base scope `mcp:invoke` is required, and a mutating tool additionally requires its
declared per-tool scope; an unauthorized call SHALL return a JSON-RPC error without invoking the
control-plane. Tool invocations SHALL be executed against the control-plane on the caller's behalf,
forwarding the caller's bearer credential.

#### Scenario: MCP client initializes and lists tools

- **WHEN** an authenticated caller POSTs a JSON-RPC `initialize` (then `tools/list`) to `/v1/mcp/rpc`
- **THEN** the server returns its protocol version + server info, and the official tool catalog

#### Scenario: a read tool proxies to the control-plane on the caller's behalf

- **WHEN** an authenticated caller with the `mcp:invoke` scope calls a read tool (e.g. `list_workspaces`)
- **THEN** the platform MCP calls the corresponding control-plane route forwarding the caller's bearer, and returns the result as tool content

#### Scenario: a mutating tool without its scope is refused

- **WHEN** a caller invokes a mutating tool (e.g. `create_workspace`) without the tool's declared scope
- **THEN** the response is a JSON-RPC error and no control-plane call is made

#### Scenario: unauthenticated access is rejected

- **WHEN** a request carries no trusted identity
- **THEN** the response is `401`
