# add-apisix-flows-mcp-routes

## Change type
enhancement

## Capability
gateway

## Priority
P2

## Why
APISIX (`deploy/kind/apisix/apisix.yaml`) has no `/v1/flows` or `/v1/mcp` route → both 404 via the gateway (executor-direct only). `/v1/websockets/*` has no handler.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: `GET /v1/flows/.../task-types` and `/v1/mcp/.../servers` → 404 NO_ROUTE at the gateway; 200 against the executor directly.

GitHub issue #560 (epic #542). Evidence: `audit/live-campaign/evidence/24-flows-mcp-realtime.md`.

## What Changes
Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config).

## Impact
`GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway.
