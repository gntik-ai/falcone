## 1. Tenant-scoped context

- [x] 1.1 New package `apps/mcp-server-sdk` (`@in-falcone/mcp-server-sdk`, type module, exports `./src/index.mjs`); `pnpm-lock.yaml` importer committed
- [x] 1.2 `src/context.mjs` `createFalconeContext({tenantId, workspaceId, call})` → frozen `{db, storage, functions, events}`; every call forces the bound scope onto the envelope (strips overrides), user data passed through; requires tenant + call transport

## 2. Official-MCP-SDK wrapper

- [x] 2.1 `src/server.mjs` `defineFalconeTool({name, description, inputSchema, handler})` + `createFalconeMcpServer({mcpServer, resolveTenant, call})` — duck-typed `.tool()`; resolves tenant from the verified request (never args); injects a fresh ctx per call (stateless); `src/index.mjs` public surface
- [x] 2.2 Python reference `python/falcone_mcp/` (FastMCP) mirroring the same contract; `README.md`

## 3. Verify

- [x] 3.1 Unit tests (9): db/storage/functions/events scoped; no-escape (authoritative envelope bound regardless of tool input); frozen ctx; tenant-from-request-not-args; a few-lines DB read; wrapper dependency validation
- [x] 3.2 `pnpm lint` (new package + README don't break validate:repo / markdownlint) + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Note: TS is the unit-tested reference; Python mirrors the contract (test harness is a follow-up); a full Go SDK and the concrete `call`↔executor transport are follow-ups. CLI scaffolds (#400) and servers (#391/#392) swap to this import incrementally.
