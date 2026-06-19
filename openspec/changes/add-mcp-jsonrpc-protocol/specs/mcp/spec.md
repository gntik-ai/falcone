# mcp — spec delta for add-mcp-jsonrpc-protocol

## ADDED Requirements

### Requirement: Hosted MCP servers expose the standard JSON-RPC wire protocol

A published, hosted per-workspace MCP server SHALL be reachable by a standard external MCP client over
the JSON-RPC 2.0 wire protocol at `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc`,
supporting the `initialize`, `tools/list`, `tools/call`, and `ping` methods so the client can discover
and invoke the server's curated tools. The request body is the JSON-RPC message; the HTTP status is
`200` for a request (the JSON-RPC envelope carries success or error) and `202` for a notification
(no `id`).

The tenant and workspace SHALL always be derived from the verified caller identity and the URL
`serverId`, never from the JSON-RPC message. A server created by one tenant SHALL be invisible to
every other tenant (its lookup resolves to a JSON-RPC error, leaking no server metadata). A request
with no verified identity SHALL be rejected with HTTP `401` before reaching the protocol handler.

Tool-call authorization (the base `mcp:invoke` scope plus a mutating tool's explicit scope), quotas,
rate limiting, telemetry, and the per-tenant audit trail SHALL be enforced identically to the
existing REST tool-call path; a scope failure surfaces as a tool-level `isError` result per MCP
convention, not as a JSON-RPC protocol error.

#### Scenario: A standard MCP client lists and calls a hosted tool over the protocol

- **WHEN** an MCP client sends `initialize` to a published hosted server's `/rpc` endpoint with a
  valid tenant identity
- **THEN** the server responds `200` with `result.protocolVersion`, `result.serverInfo.name`, and
  `result.capabilities.tools`
- **AND WHEN** the client sends `tools/list`
- **THEN** the response lists the server's published tools, each with a `name` and an `inputSchema`
- **AND WHEN** the client sends `tools/call` for a read tool
- **THEN** the call is executed against the real backing route (workspace bound to the credential)
  and the response carries the tool `content` with `isError: false`

#### Scenario: Cross-tenant access to a hosted server is rejected without leaking metadata

- **WHEN** a caller authenticated for tenant B sends `initialize` to a server owned by tenant A
- **THEN** the response is a JSON-RPC error and contains no `serverInfo` for tenant A's server
- **AND WHEN** a caller presents no verified identity
- **THEN** the request is rejected with HTTP `401`

#### Scenario: Notifications are acknowledged without a response body

- **WHEN** the client sends a JSON-RPC notification (e.g. `notifications/initialized`, no `id`)
- **THEN** the server responds `202` with no JSON-RPC response body
