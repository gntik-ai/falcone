## Why

Writing a tool against the platform should be a few lines. A thin SDK should wrap the official MCP server SDKs and inject **tenant-scoped Falcone clients** (`db` / `storage` / `functions` / `events`), so a tool reads/writes the tenant's data automatically scoped (RLS-bound) with no way to escape that scope. This resolves issue **#401** (epic #386) and is the context-injection layer used by the official server (#391), Instant MCP (#392), and the CLI scaffolds (#400).

## What Changes

- **New package** `@in-falcone/mcp-server-sdk` (`apps/mcp-server-sdk`):
  - `createFalconeContext({ tenantId, workspaceId, call })` → a frozen `ctx` with `db`/`storage`/`functions`/`events` clients pre-bound to the tenant/workspace. Every client call forces the bound scope onto the request envelope; nested user data (filter/row/payload) is passed through. There is **no API to widen or change the scope**.
  - `defineFalconeTool({ name, description, inputSchema, handler })` + `createFalconeMcpServer({ mcpServer, resolveTenant, call })` — wrap an official MCP server (duck-typed `.tool()`), resolve the tenant from the **verified request credential** (never from tool args), and inject a fresh tenant-scoped ctx per invocation (stateless).
- **Languages:** TypeScript/JavaScript reference (unit-tested) plus a Python (FastMCP) module mirroring the same contract.
- **Tenant safety:** the tenant comes from the credential, never from arguments; a tool cannot reach another tenant; the executor applies RLS from the attached tenant.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add the **server SDK** — tenant-scoped `db`/`storage`/`functions`/`events` clients injected into tool handlers over the official MCP SDK, with credential-derived scope that cannot be escaped. Builds on the #387 context-injection model; used by #391/#392/#400.

## Impact

- **New package:** `apps/mcp-server-sdk` (`@in-falcone/mcp-server-sdk`): `src/{index,context,server}.mjs` + co-located tests; `python/falcone_mcp/` reference; `README.md`. `pnpm-lock.yaml` gains the no-deps importer entry.
- **Integrations:** the CLI `init` scaffolds (#400) swap their upstream-SDK import for this; the official (#391) and Instant (#392) servers build their tools on it.
- **Out of scope:** generation/curation (#392/#393); the CLI (#400); the executor/data-plane transport itself (injected as `call`).
