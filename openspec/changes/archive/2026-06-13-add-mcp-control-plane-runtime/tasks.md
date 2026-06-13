## 1. Integration engine

- [x] 1.1 `apps/control-plane/src/runtime/mcp-engine.mjs` — `createMcpEngine()` composing the pure modules (generator/catalog → curation → registry → quota → observability → official-server); in-memory per-tenant state; platform-image-digest pinning honors the registry contract unchanged
- [x] 1.2 `executeMcp` operations: list/create/get/curate/publish/approve/call/audit/delete — all keyed by `identity.tenantId`; quota/rate breaches throw `{statusCode, code, dimension}`

## 2. Runtime wiring

- [x] 2.1 `runtime/server.mjs` — `/v1/mcp/...` route block (gated on injected `mcpEngine`) + `runMcp` helper, matching the flows pattern; identity/tenant from `resolveIdentity`
- [x] 2.2 `runtime/main.mjs` — inject `createMcpEngine()` when `MCP_ENABLED=true`

## 3. Verify (unit + local + kind)

- [x] 3.1 Engine unit tests (5): full loop, cross-tenant 404, version-pinning review→approve, server-count quota 429, delete
- [x] 3.2 Local live runtime: booted `main.mjs` with `MCP_ENABLED=true`, full curl flow (create→curate→publish→get→call→audit) + the Playwright MCP suite → 12 passed
- [x] 3.3 KIND: built `in-falcone-control-plane-executor:0.9.6-mcp`, pushed to `localhost:30500`, deployed an ephemeral `mcp-cp-executor` (ns `mcp-e2e`, `MCP_ENABLED=true`), port-forwarded, ran the full MCP E2E suite → **12 passed** (evidence: `spikes/add-mcp-control-plane-runtime/evidence/kind-e2e-run.txt`); namespace torn down

## 4. E2E spec alignment (minimal)

- [x] 4.1 `mcp-version-pinning` sends a real curation description change (not a magic flag); `mcp-full-loop` invokes a real curated tool from the published manifest

## 5. Finalize

- [x] 5.1 No reviewed module contract changed (registry digest requirement honored via the platform runtime image); `openspec validate --strict` + `pnpm lint` + `test:unit` + `test:contracts` pass; Postgres-backed registry + per-server ksvc connection noted as follow-ups
