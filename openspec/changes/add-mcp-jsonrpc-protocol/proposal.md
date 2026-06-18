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

## What Changes
Expose the MCP protocol surface so a standard MCP client can list+call tools.

## Impact
A standard MCP client lists and calls a hosted tool over the protocol.
