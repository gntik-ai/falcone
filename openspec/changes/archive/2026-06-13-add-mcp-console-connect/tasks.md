## 1. Pure cores (lib/mcp)

- [x] 1.1 `generateMcpConnectSnippets({name, slug, endpoint})` → `SnippetEntry[]`: Cursor install deeplink (base64 remote config), Claude Code `.mcp.json`, claude.ai connector URL, VS Code `.vscode/mcp.json`; no static secret; OAuth note on each; endpoint placeholder + note when unpublished
- [x] 1.2 `toMcpServerDetailViewModel(payload)` → endpoint/status/active-version/source/curated-tools (tolerates registry active-version envelope #396 or a flat server)
- [x] 1.3 `buildPlaygroundToolCall({endpoint, toolName, args, accessToken})` → authenticated JSON-RPC `tools/call` (Bearer + MCP-Protocol-Version 2025-11-25); throws without token/endpoint. `mcp-api`: `fetchMcpServerDetail` + `invokeMcpTool` via the console session

## 2. Console UI

- [x] 2.1 `McpServerConnectPanel` (renders the connect snippets via `<ConnectionSnippets>`)
- [x] 2.2 `McpServerPlayground` (tool picker + JSON args + invoke via injectable OAuth-backed call + structured result; invalid-JSON guard; disabled when no endpoint)
- [x] 2.3 `ConsoleMcpServerDetailPage` (endpoint/version/status header + curated tool list + Connect/Playground tabs) and route `/console/mcp/servers/:mcpServerId` (eager import — lazy throws React #426 in this build)

## 3. Verify (web-console baseline)

- [x] 3.1 New vitest suites pass: connect-snippets (7), server-detail (5), connect panel (1), playground (3), detail page (2) — 18/18; `npx tsc --noEmit` reports no errors in the new/changed files
- [x] 3.2 Full web-console suite: failing set unchanged (pre-existing 3 files / global-stub teardown — ConsoleShellLayout, console-context, ConsoleMembersPage); `router.test.tsx` still green with the new route; root `pnpm lint` + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Snippet/connect formats isolated in one pure module (easy to re-pin as client config formats evolve); long-running Tasks playground (#395 flow tools) and MCP Inspector embedding noted as follow-ups
