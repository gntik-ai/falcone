## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #794 acceptance criteria:
  - Requirement: The system SHALL serve the MCP server detail page by calling a backend route that
    actually returns the server's detail and supports Connect/Playground.
  - Scenario: WHEN a tenant_owner opens `/console/mcp/servers/{serverId}` for an existing server in
    their workspace, THEN the page loads endpoint/version/status/tools with HTTP 200 and the Connect
    and Playground tabs are usable.
- [x] 1.2 Confirm the current root cause from source:
  - `fetchMcpServerDetail` called `GET /v1/mcp/servers/{id}`;
  - `invokeMcpTool` called `POST /v1/mcp/servers/{id}/playground/tool-calls`;
  - `apps/control-plane/src/runtime/server.mjs` serves the MCP routes only under
    `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}` and
    `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`.
- [x] 1.3 Add focused frontend and runtime tests that encode the served workspace-scoped routes and
  the no-active-workspace state.

## 2. Implement the web-console fix

- [x] 2.1 Change `fetchMcpServerDetail` to require `workspaceId` and call
  `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}`.
- [x] 2.2 Change `invokeMcpTool` to require `workspaceId` and call
  `/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls`.
- [x] 2.3 Read `activeWorkspaceId` from the existing console context in
  `ConsoleMcpServerDetailPage`.
- [x] 2.4 Avoid issuing any MCP detail request when no active workspace exists and render a clear
  no-workspace state.
- [x] 2.5 Thread `workspaceId` through `McpServerPlayground`.

## 3. Backend / contract alignment

- [x] 3.1 Keep the backend workspace-scoped route model; do not register unscoped MCP detail or
  playground aliases.
- [x] 3.2 Add the served workspace-scoped `tool-calls` route to the legacy gateway MCP route catalog.
- [x] 3.3 Add a deterministic runtime route test showing the workspace-scoped detail and tool-call
  routes return 200 and the old unscoped routes remain `NO_ROUTE`.
- [x] 3.4 Add a route-catalog regression test for the workspace-scoped MCP detail/tool-call paths and
  against the old unscoped paths.

## 4. Docs and OpenSpec

- [x] 4.1 Materialize this OpenSpec change under
  `openspec/changes/fix-794-mcp-detail-workspace-route/`.
- [x] 4.2 Add a human architecture/reference note for the MCP console route mapping.

## 5. Verify

- [x] 5.1 Run focused web-console Vitest tests for MCP detail/playground/API helpers.
- [x] 5.2 Run focused Node runtime/catalog tests.
- [x] 5.3 Run OpenSpec validation for this change.
- [x] 5.4 Run `git diff --check`.
- [ ] 5.5 Deploy to a designated local kind cluster and verify the UI against live URLs.
  Blocked in this run: the active kube-context is `default`, not a local `kind-*` context, and the
  hosted Musematic endpoint is read-only/prod-like.

Additional local checks run:

- [x] `npm run generate:public-api` (no generated-file drift for this change).
- [x] `npm run validate:public-api`.
- [x] `npm run validate:gateway-policy`.
- [ ] `pnpm --filter @in-falcone/web-console typecheck`.
  Blocked by pre-existing unrelated TypeScript failures in backup/plan/member/secret console files
  and a duplicated `@remix-run/router` private type mismatch; the focused MCP tests compile and pass.
