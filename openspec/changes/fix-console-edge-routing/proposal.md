Tracking issue: gntik-ai/falcone#505

## Why

No ingress controller is deployed, so the console SPA's same-origin `/v1/*` calls have no edge to reach the control-plane. A real browser on the console host receives HTML for every API call instead of an API response, so the console cannot talk to the backend in the deployed topology.

Live proof (`tests/live-audit/evidence/12-console-parity.md`, CONS-3): the SPA targets hardcoded ingress hostnames that don't resolve and no ingress controller is deployed; same-origin `/v1` is unrouted.

## What Changes

- Provide an edge (ingress controller + routes, or equivalent) so the console's same-origin `/v1/*` requests are routed to the control-plane/gateway in the deployed topology.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: The console's same-origin `/v1/*` API calls are routed to the control-plane at the edge, so the console reaches the API end-to-end.

## Impact

- Ingress controller / edge routing for the console host's `/v1/*` paths.
