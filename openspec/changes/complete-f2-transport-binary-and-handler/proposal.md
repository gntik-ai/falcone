## Why

The realtime-subscriptions transport binary does not exist in this
repository: the chart references a remote image and the capability-gated
paths have no APISIX upstream. From
`openspec/audit/cap-f2-realtime-subscriptions-transport.md`:

- **B1** (`charts/realtime-gateway/values.yaml:1-3` references
  `ghcr.io/falcone/realtime-gateway:latest`; `grep -rn
  "ghcr.io/falcone/realtime-gateway"` returns only chart values and the
  B2 library's `package.json`) — no Dockerfile, no HTTP/WS server, no
  SSE writer, no Kafka-to-WS bridge anywhere in source.
- **B5** (`services/gateway-config/routes/capability-gated-routes.yaml:18-22`)
  — `/v1/workspaces/*/realtime[/*]` and `GET /v1/events/subscribe` are
  capability-gated but have no APISIX route in
  `charts/in-falcone/values.yaml`. The gates protect routes that don't
  exist in the deployed table.
- **G1** (cross-cutting) — the transport binary's absence is the
  root-cause of every other F2 gap.
- **G4** (capability-gated-routes.yaml) — gates without routes.
- **G6** — no handler for `GET /v1/events/subscribe`.

This change brings the transport binary into the repository so the
existing B2 authorization library, the existing chart, and the existing
OpenAPI declarations all converge on one runnable artefact.

## What Changes

- Add `services/realtime-gateway/transport/` containing the long-lived
  Fastify server: WS upgrade, SSE writer, `/healthz/{live,ready}`,
  `/metrics`, JWT validation through the existing B2 `validateToken`,
  session lifecycle through `createSessionManager`, scope checks
  through `checkScopes`, and Kafka-to-WS fan-out through a new
  consumer module.
- Add `services/realtime-gateway/Dockerfile` and a CI workflow that
  builds and publishes `ghcr.io/falcone/realtime-gateway`.
- Add handler entries for `POST /v1/websockets/sessions`, `GET
  /v1/websockets/sessions/{sessionId}`, and `GET
  /v1/events/subscribe` so the OpenAPI declarations have a real owner.
- Add APISIX route entries to
  `services/gateway-config/routes/realtime-gateway-routes.yaml` for the
  `/v1/workspaces/*/realtime[/*]` and `/v1/events/subscribe` paths so
  the capability gates are no longer dangling.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: the transport tier becomes part of the
  repository; the B2 library has a real consumer; the
  capability-gated paths are routable.

## Impact

- **Affected code**: new files under
  `services/realtime-gateway/transport/`, new `Dockerfile`, new
  `.github/workflows/realtime-gateway-image.yml`, new
  `services/gateway-config/routes/realtime-gateway-routes.yaml`,
  minor edits to `apps/control-plane/openapi/families/websockets.openapi.json`
  to correct `x-owning-service` (covered by `fix-f2-route-misalignment`).
- **Migration**: none — sessions persist via existing B2 schema.
- **Breaking changes**: routes 1003/2011 in
  `charts/in-falcone/values.yaml` will be re-pointed away from
  `controlPlane` in the partnered Helm change
  (`complete-f2-chart-wiring`). Documented in PR.
- **Out of scope**: chart-side wiring (`complete-f2-chart-wiring`), URL
  prefix corrections for routes 2014/2015
  (`fix-f2-route-misalignment`), pod resilience tuning
  (`harden-f2-pod-resilience`).

See `design.md` for transport layout, integration with the B2 library,
image build/publish plan, and the cut-over sequence with the chart-side
proposal.
