# MCP Console Route Mapping

The MCP server detail console page is a shell-context route:

- Console route: `/console/mcp/servers/{serverId}`
- Workspace source: `ConsoleContextProvider` restores and exposes `activeWorkspaceId`
- Detail API call: `GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}`
- Playground API call: `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`

The page intentionally does not put `workspaceId` in the browser URL. Deep links rely on the console
shell restoring the active workspace selection for the signed-in user. Until that context is
available, the page must not issue an MCP request; if no active workspace can be selected, it renders a
clear "select a workspace" state.

The backend MCP hosting routes are workspace-scoped in `apps/control-plane-executor/src/runtime/server.mjs`.
Do not add or call unscoped aliases such as `GET /v1/mcp/servers/{serverId}` or
`POST /v1/mcp/servers/{serverId}/playground/tool-calls`; those paths are not served and would bypass
the route shape used for tenant/workspace isolation. The legacy gateway MCP route catalog in
`deploy/gateway-config/public-route-catalog.json` should advertise the served workspace-scoped
detail and `tool-calls` paths.
