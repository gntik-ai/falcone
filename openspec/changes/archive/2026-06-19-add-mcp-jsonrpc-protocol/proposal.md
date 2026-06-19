# add-mcp-jsonrpc-protocol

## Change type
enhancement

## Capability
mcp

## Priority
P2

## Why
MCP server hosting works via the internal management API, but the standard MCP wire protocol is not exposed for external MCP clients.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: tool list/call work through the internal API; no JSON-RPC/Streamable-HTTP endpoint for a standard client.

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/14-workflows-mcp-realtime.md`.

The platform (first-party) MCP server already speaks JSON-RPC at `POST /v1/mcp/rpc`
(`add-platform-mcp-http-route`, #607: `initialize`/`tools/list`/`tools/call`/`ping`). The gap is the
**hosted, per-workspace** MCP servers a tenant creates/curates/publishes: they were reachable only
through the internal REST `tool-calls` route, so a standard MCP client had no wire surface to
`initialize` and call their tools.

## What Changes
Expose each hosted, published per-workspace MCP server over the standard JSON-RPC 2.0 wire protocol
at `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc`, supporting `initialize`,
`tools/list`, `tools/call`, and `ping` (plus JSON-RPC notifications). The handler reuses the existing
engine internals — `tools/list` reads the active published manifest; `tools/call` goes through the
same `call_tool` path, so scope-gating, quotas, rate limits, telemetry, and the audit trail are
unchanged. Tenant/workspace are credential-derived (never from the message); the existing gateway
`/v1/mcp/*` route already covers the new path, so no APISIX change is needed.

**Scope decision (2026-06-19, confirmed with the operator):** minimal-but-standard JSON-RPC over HTTP
POST. Deferred (tracked separately): the Streamable-HTTP SSE transport (sessions, server→client
stream) and the `resources/*` / `prompts/*` method families — a standard client can list and call
tools over plain JSON-RPC POST without them.

## Impact
A standard MCP client lists and calls a hosted tool over the protocol.

- `apps/control-plane/src/runtime/mcp-engine.mjs` — new `executeMcpRpc` JSON-RPC dispatcher.
- `apps/control-plane/src/runtime/server.mjs` — new `POST .../servers/{serverId}/rpc` route + `runMcpRpc`.
- Served by the `cp-executor` image (same one already serving `/v1/mcp/*`); no `deploy/kind`/chart change.
- Tests: `tests/blackbox/mcp-hosted-jsonrpc.test.mjs`.
