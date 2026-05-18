## Why

The `services/event-gateway/` package is a contract-validation layer only;
the HTTP, WS, and Kafka-producer handlers that the capability map promises
are absent. From `openspec/audit/cap-f1-event-gateway.md`:

- **B4** (`services/event-gateway/src/*.mjs`) — `grep -E
  "http.createServer|fastify|express"` returns no matches. The README
  describes "intended server behaviour" but the package exports
  validators/normalisers only.
- **G1** (cross-cutting) — the umbrella chart declares 16 metrics routes,
  the events family, and the websockets family
  (`apps/control-plane/openapi/families/{events,websockets,metrics}.openapi.json`)
  but no source in the repo materialises a production handler that
  consumes the validated envelope and writes to Kafka, opens a WS, or
  starts an SSE stream. The capability is a four-corner stranded stack.

The capability cannot be operated end-to-end without an implemented
handler. This change adds the missing handler tier so the existing
validator package becomes the contract pre-flight for a running runtime.

## What Changes

- Stand up an OpenWhisk-action handler set under
  `services/event-gateway/actions/` for `events.publish`,
  `events.subscribe.create` (initial session bootstrap), and
  `events.topics.metadata`, consuming the existing
  `validateEventPublicationRequest` / `validateEventSubscriptionRequest`
  exports.
- Wire the Kafka producer through the existing
  `services/adapters/src/kafka-admin.mjs` port so the action handlers
  publish accepted envelopes to the canonical topic resolved by the
  validator.
- For the WebSocket and SSE long-lived paths, register a Fastify-based
  transport under `services/event-gateway/transport/` (separate from the
  action handlers) and expose `/healthz/{live,ready}` plus the four
  `EVENT_GATEWAY_REQUIRED_METRICS` on `/metrics`.
- Add `services/gateway-config/routes/event-gateway-routes.yaml`
  declaring the upstream component so APISIX in `charts/in-falcone/` can
  target the new transport instead of `controlPlane`.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: the publish/subscribe/metadata surface gains a
  runnable handler set that consumes the existing contract layer; the
  capability is no longer validators-only.

## Impact

- **Affected code**: new files under
  `services/event-gateway/actions/`,
  `services/event-gateway/transport/`,
  `services/gateway-config/routes/event-gateway-routes.yaml`; minor
  edits to `apps/control-plane/src/events-admin.mjs` to surface the
  handler set.
- **Migration**: no schema migration. Helm-side: an upstream `component:
  eventGatewayTransport` entry must be added to `charts/in-falcone/values.yaml`.
- **Breaking changes**: routes 1003 and 2011 in
  `charts/in-falcone/values.yaml` currently target `controlPlane`; once
  the transport is wired, they must be re-pointed. Document the cut-over
  in PR.
- **Out of scope**: WS reconnect storage (sessions are still ephemeral —
  durability is a follow-up `complete-f2-*` work item), Kafka consumer
  fan-out into open WS sessions (also F2 scope).

See `design.md` for handler placement, transport choice rationale, and
the Kafka producer wiring.
