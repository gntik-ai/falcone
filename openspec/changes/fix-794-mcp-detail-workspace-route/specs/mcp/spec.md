# mcp — spec delta for fix-794-mcp-detail-workspace-route

## MODIFIED Requirements

### Requirement: MCP hosted-server detail and REST tool-call routes are workspace-scoped

The system SHALL expose MCP hosted-server detail and REST Playground/tool-call operations under the
workspace-scoped MCP hosting prefix:
`/v1/mcp/workspaces/{workspaceId}/servers/{serverId}`. Detail reads SHALL be served by
`GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}` and REST tool invocations SHALL be served
by `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`. The backend SHALL derive
tenant and workspace authority from the verified identity and path scope and SHALL NOT require an
unscoped `/v1/mcp/servers/{serverId}` detail or `/playground/tool-calls` alias to make the console
usable.

#### Scenario: Detail and playground resolve to existing workspace-scoped routes

- **WHEN** the console requests an MCP server's detail or invokes a tool from the Playground for an
  existing server in the caller's workspace
- **THEN** the requests target the workspace-scoped routes that the runtime serves and return HTTP 200
  for an existing server
- **AND THEN** unscoped `/v1/mcp/servers/{serverId}` and
  `/v1/mcp/servers/{serverId}/playground/tool-calls` are not advertised as the console contract
