# add-platform-mcp-http-route

## Change type
enhancement

## Capability
mcp

## Priority
P2

## Why
`mcp-official-server.mjs` (the platform management MCP, ~9 tools) exists but has no HTTP route in `server.mjs` -> the platform MCP interface (C25) is unreachable.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: no HTTP route serves the platform MCP; MCP hosting + MCP->workflow otherwise work.

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/14-workflows-mcp-realtime.md`.

## What Changes
Register an HTTP route for the platform MCP server (tenant-scoped).

## Impact
An MCP client connects to the platform MCP and manages projects/resources, tenant-scoped.
