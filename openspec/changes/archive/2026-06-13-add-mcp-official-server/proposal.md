## Why

Tenants want to manage their Falcone project from MCP clients (Claude, Cursor, VS Code, claude.ai connectors) — like Supabase's and Appwrite's first-party MCP servers. Falcone should ship a **first-party MCP server** that exposes its management surface as MCP tools, **read-first**, with **explicit scopes for any mutating tool**. The hard-won lesson from teams running many production MCP servers is that tool quality (a pruned, well-described tool set) matters more than coverage — so this is a **curated catalog**, not a 1:1 dump of the 36 `structural_admin` routes. It resolves issue **#391** (epic #386); builds on the runtime (#388), gateway (#389) and OAuth AS (#390); will adopt the Server SDK (#401) for tenant-scoped clients.

## What Changes

- A **first-party Falcone MCP server**: an MCP server (Streamable HTTP, JSON-RPC `initialize`/`tools/list`/`tools/call`) whose tools call the control-plane on behalf of the authenticated tenant (credential-derived, ADR-2).
- A **curated tool catalog** grounded in the real public routes:
  - **Read tools** (default, safe): list/inspect tenants, workspaces, members, schemas, functions, plans, quotas, usage — mapped to `GET` routes; require only the base `mcp:invoke` scope.
  - **Mutating tools** (off unless explicitly granted): create/update/delete workspaces, members, schemas, functions, etc. — mapped to `POST/PUT/DELETE` routes; **each requires an explicit per-tool scope** (`mcp:falcone:<area>:write`) and is refused without it.
  - Every tool carries an **LLM-optimized description** and an input schema; destructive tools are clearly marked.
- **Read-first gating** in the server: mutating tools are listed but a `tools/call` to one fails unless its scope is present in the caller's granted scopes (from the #390 token).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add requirements for the **first-party Falcone MCP server** — a curated, read-first management tool catalog where every mutating tool requires an explicit scope. Builds on the foundational `mcp` capability (#387).

## Impact

- **Control-plane:** the first-party server's tool catalog + MCP request handler live in `apps/control-plane/src/` (a first-party platform component); tools call the control-plane API via an injected client (testable with fakes; will use the Server SDK #401). Extractable to its own deployable image later.
- **Reuses:** the public route catalog (the management surface), OAuth scopes (#390), the MCP transport (#389), the runtime (#388).
- **Out of scope:** Instant MCP generation (#392), custom server hosting (#394), the Connect UX/playground (#397), the Server SDK package itself (#401).
