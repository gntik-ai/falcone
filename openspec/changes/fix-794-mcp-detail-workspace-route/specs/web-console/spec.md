# web-console — spec delta for fix-794-mcp-detail-workspace-route

## MODIFIED Requirements

### Requirement: MCP server detail page calls served workspace-scoped routes

The system SHALL serve the MCP server detail page by calling backend routes that actually return the
server's detail and playground tool-call result under the active workspace scope:
`GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}` for detail and
`POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls` for Playground invocations.
The detail page SHALL derive `workspaceId` from the existing console context rather than from an
unscoped route parameter, and SHALL NOT call the retired/unserved paths
`/v1/mcp/servers/{serverId}` or `/v1/mcp/servers/{serverId}/playground/tool-calls`.

When no active workspace is available from the console context, the page SHALL render a clear
no-workspace state and SHALL NOT issue an MCP server detail or playground request. When the console
shell restores an active workspace for a deep link, the page SHALL use that workspace to load the
server detail and render the server header, endpoint, active version, status, curated tools, Connect
tab, and Playground tab.

#### Scenario: Open the detail page for an existing MCP server

- **WHEN** a `tenant_owner` opens `/console/mcp/servers/{serverId}` for a server that exists in their
  active workspace
- **THEN** the console requests
  `GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}`
- **AND THEN** the backend returns HTTP 200 with the server endpoint, active version, status, and
  curated tools
- **AND THEN** the page renders the server header, tool list, Connect tab, and Playground tab instead
  of the MCP detail error state

#### Scenario: Playground tool calls use the served workspace-scoped route

- **WHEN** a `tenant_owner` invokes a curated tool from the MCP detail Playground tab
- **THEN** the console requests
  `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`
- **AND THEN** the request targets a served backend route that returns HTTP 200 for an existing
  server, and the page renders the tool result instead of a 404 error state

#### Scenario: No active workspace means no bad MCP request

- **WHEN** `/console/mcp/servers/{serverId}` renders before the console shell has an active workspace
  or after no active workspace can be selected
- **THEN** the page shows a clear no-workspace state
- **AND THEN** it does not request `/v1/mcp/servers/{serverId}`,
  `/v1/mcp/servers/{serverId}/playground/tool-calls`, or any workspace-scoped MCP route with an empty
  workspace id
