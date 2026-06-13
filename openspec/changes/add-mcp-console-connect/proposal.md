## Why

Connecting a client is where MCP adoption is won or lost. A tenant who has published a server (instant #392 / custom #394 / official #391, governed by the registry #396) needs, in the console: the **endpoint**, **one-click connect** for the popular clients, and a way to **try a tool** before wiring anything up. This resolves issue **#397** (epic #386).

## What Changes

- **Server detail view**: endpoint URL, status, **active version** (from #396) and the **curated tool list** (#393), shaped by a pure view-model.
- **Connect tab**: a one-click **"Add to Cursor"** deeplink plus copy-paste config for **Claude Code (`.mcp.json`)**, **claude.ai custom connectors** (remote URL) and **VS Code (`.vscode/mcp.json`)** — generated client-side as `SnippetEntry[]` and rendered by the existing `<ConnectionSnippets>`. Transport is Streamable HTTP; **no static secret** is embedded — auth is the per-tenant OAuth 2.1 flow (#390).
- **Interactive playground**: pick a curated tool, supply JSON arguments, invoke it **through the OAuth flow**, and see the structured result. The authenticated `tools/call` request is built by a pure helper; the call rides the console session.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add the **console connect + playground** surface — server detail (endpoint, version, curated tools), client-config snippets (Cursor/Claude Code/claude.ai/VS Code), and an OAuth-backed interactive playground. Builds on the foundational `mcp` capability (#387), registry (#396), curation (#393) and OAuth (#390).

## Impact

- **web-console:** new `src/lib/mcp/` (pure: `mcp-connect-snippets`, `mcp-server-detail`, plus the `mcp-api` session calls), `src/components/console/mcp/` (`McpServerConnectPanel`, `McpServerPlayground`), `src/pages/ConsoleMcpServerDetailPage.tsx`, and a route `/console/mcp/servers/:mcpServerId`.
- **Tests:** new vitest suites (pure + component + page) all pass; the console's pre-existing broken-baseline failing set is unchanged (CI does not run the web-console suite).
- **Out of scope:** observability dashboards (#398); curation editing UI (#393); a public marketplace.
