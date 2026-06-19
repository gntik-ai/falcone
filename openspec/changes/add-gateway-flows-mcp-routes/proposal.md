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

## Status (SUPERSEDED — corrected scope, 2026-06-19)
This change is **already implemented** by the archived `add-apisix-flows-mcp-routes` (#560). The
current `deploy/kind/apisix/apisix.yaml` already routes both surfaces to the executor:

- route `2017-flows` — `/v1/flows/*` → `falcone-cp-executor` (priority 245, above the `/v1/*`
  catch-all), strips client identity headers + injects `x-gateway-auth`.
- route `2018-mcp` — `/v1/mcp/*` → `falcone-cp-executor` (priority 244), same gateway-trust idiom.

The re-run dry-run regenerated an already-resolved finding (the stack-facts brief was written before
the routes landed). The only residual mentioned — `/v1/websockets/*` — has **no handler anywhere in
the codebase**: realtime is delivered over **SSE** (the `/changes` route → executor, route `2016-rt`),
not WebSockets, by design. There is no WS transport to route, so this is a genuinely-absent feature,
not a gateway gap.

**Decision:** close as superseded by #560. No code change. (If a WebSocket realtime transport is ever
added, route it then — tracked separately, not part of this issue.)

## Impact
`/v1/flows/...` and `/v1/mcp/...` -> 200 via the gateway (already true via #560).
