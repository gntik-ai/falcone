# Change: fix-794-mcp-detail-workspace-route

## Why

Issue #794 is a confirmed console/backend route mismatch on the MCP server detail page.

The web console route `/console/mcp/servers/{serverId}` called unscoped backend paths:
`GET /v1/mcp/servers/{serverId}` and
`POST /v1/mcp/servers/{serverId}/playground/tool-calls`. The deployed runtime does not serve those
paths; it serves MCP hosting under the workspace-scoped prefix
`/v1/mcp/workspaces/{workspaceId}/servers/{serverId}`. As a result, a tenant owner deep-linking to an
existing MCP server detail page could only see the page's error state, and the Connect and Playground
tabs never became usable.

The issue acceptance criteria are:

- Requirement: The system SHALL serve the MCP server detail page by calling a backend route that
  actually returns the server's detail (endpoint, active version, curated tools), so the page renders
  the server header, tool list, Connect tab and Playground tab.
- Scenario: WHEN a tenant_owner opens `/console/mcp/servers/{serverId}` for a server that exists in
  their workspace, THEN the page loads the server's endpoint/version/status and curated tools
  (HTTP 200), and Connect and Playground tabs are usable.

## What Changes

- Update the web-console MCP data client so detail and playground requests require the active
  `workspaceId` and target the served workspace-scoped runtime routes:
  - `GET /v1/mcp/workspaces/{workspaceId}/servers/{serverId}`
  - `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`
- Resolve the workspace for `/console/mcp/servers/{serverId}` from the existing console shell context
  (`useConsoleContext`). Deep links wait for the shell to restore the active workspace and then fetch
  the server detail.
- Render a clear no-workspace state and issue no backend request when the shell cannot provide an
  active workspace.
- Thread `workspaceId` into the Playground component so tool invocations use the same scoped route as
  the detail fetch.
- Add the served `tool-calls` path to the legacy gateway MCP route catalog with the data-access
  privilege domain. Server list/create/detail/delete remain structural-admin operations.
- Add deterministic frontend, runtime, and route-catalog tests for the issue scenario and the absence
  of the old unscoped routes.
- Add a short architecture note documenting the console route-to-backend mapping.

## Impact

- Frontend:
  - `apps/web-console/src/lib/mcp/mcp-api.ts`
  - `apps/web-console/src/pages/ConsoleMcpServerDetailPage.tsx`
  - `apps/web-console/src/components/console/mcp/McpServerPlayground.tsx`
- Backend/runtime and wire:
  - no new unscoped backend route is added;
  - the existing workspace-scoped runtime routes remain the source of truth;
  - `services/gateway-config/public-route-catalog.json` now includes the served workspace-scoped
    playground `tool-calls` route.
- Docs/OpenSpec:
  - this OpenSpec change under `openspec/changes/fix-794-mcp-detail-workspace-route/`;
  - `docs/reference/architecture/mcp-console-route-mapping.md`.

## Non-Goals

- No attempt to make `/v1/mcp/servers/{serverId}` a compatibility alias; that would introduce a
  second addressing mode for tenant/workspace-scoped MCP state.
- No navigation/sidebar reachability work for the detail page. The issue notes that reachability is
  tracked separately by #741/#792.
- No cluster deployment in this run. The active kube-context is not a local `kind-*` context and the
  hosted Musematic deployment is read-only/prod-like.
