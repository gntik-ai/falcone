# add-gateway-flows-mcp-routes

## Change type
enhancement

## Capability
gateway

## Priority
P2

## Why
APISIX has no `/v1/flows` or `/v1/mcp` route (executor-direct only); `/v1/websockets/*` has no handler.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: `GET /v1/flows/.../task-types` and `/v1/mcp/.../servers` -> 404 at the gateway; 200 against the executor directly.

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/14-workflows-mcp-realtime.md`.

## What Changes
Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes.

## Impact
`/v1/flows/...` and `/v1/mcp/...` -> 200 via the gateway.
