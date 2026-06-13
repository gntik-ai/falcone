## 1. Curated tool catalog

- [x] 1.1 `mcp-official-catalog.mjs`: a curated catalog of Falcone management tools, each `{ name, description (LLM-optimized), inputSchema, mutates, scope, method, path }`, grounded in real public routes (GET → read, POST/PUT/DELETE → mutating)
- [x] 1.2 Helpers: `readTools()`, `mutatingTools()`, `toolByName()`, `toolsListForClient()` (the `tools/list` shape)

## 2. First-party MCP server (read-first)

- [x] 2.1 `mcp-official-server.mjs`: `handleMcpMessage(msg, { grantedScopes, callFalcone })` — `initialize` / `tools/list` / `tools/call`
- [x] 2.2 Read-first gating: read tools callable with base scope; a mutating `tools/call` is refused unless its scope is in `grantedScopes`; tenant is credential-derived (never from tool args)
- [x] 2.3 Mutating calls invoke `callFalcone(method, path, body)` (injected; later the Server SDK #401)

## 3. Verify

- [x] 3.1 Unit tests: read tool callable; mutating refused without scope / allowed with scope; every tool described + classified; every mutating tool has a scope
- [x] 3.2 `pnpm lint` + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Confirm read-first default and that no tool reads the tenant from its arguments
