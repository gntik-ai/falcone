Tracking issue: gntik-ai/falcone#505

## Why

No ingress controller is deployed, so the console SPA's same-origin `/v1/*` calls have no edge to reach the control-plane. A real browser on the console host receives HTML for every API call instead of an API response, so the console cannot talk to the backend in the deployed topology.

Live proof (`tests/live-audit/evidence/12-console-parity.md`, CONS-3): the SPA targets hardcoded ingress hostnames that don't resolve and no ingress controller is deployed; same-origin `/v1` is unrouted.

## What Changes

- Corrected scope after reading the deploy: an ingress controller AND APISIX `/v1/*` routes already exist; the real gap is that the console pod's own nginx had no `/v1` edge, so its SPA catch-all (`try_files … /index.html`) rewrote same-origin `/v1/*` calls to `index.html` — the browser got HTML for every API call. Add a `/v1/` proxy in the console nginx to the gateway (APISIX), so same-origin `/v1/*` reaches the control-plane (APISIX validates the JWT + forwards). The upstream is env-configurable (`GATEWAY_UPSTREAM`, default `falcone-apisix:9080`) so the chart can point it at its own gateway service.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: The console's same-origin `/v1/*` API calls are routed to the control-plane at the edge, so the console reaches the API end-to-end.

## Impact

- Ingress controller / edge routing for the console host's `/v1/*` paths.
