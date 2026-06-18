# add-mcp-workflow-and-platform-binding

## Change type
enhancement

## Capability
mcp

## Priority
P2

## Why
`apps/control-plane/src/mcp-workflows-tools.mjs` (#395) is imported only by its test; the MCP engine never wires flow-backed tools → an MCP tool cannot trigger a Falcone workflow. The platform 'official' MCP server exposes 9 management tools but none execute (same as F1).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: no live API path creates a flow-backed MCP tool; platform MCP tool-calls return the executor index.

GitHub issue #566 (epic #544). Evidence: `audit/live-campaign/evidence/24-flows-mcp-realtime.md`.

## What Changes
Wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the control-plane.

## Impact
An MCP tool starts a workflow and returns its result; a platform MCP tool creates a project.

Dependencies: Depends on F1, E1.
