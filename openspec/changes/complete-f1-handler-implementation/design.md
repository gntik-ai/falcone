# Design — complete-f1-handler-implementation

## Goals

1. The validator package in `services/event-gateway/src/` gains a runnable
   handler set so accepted publish envelopes actually reach Kafka.
2. Long-lived WS / SSE sessions terminate on an event-gateway-owned
   transport process, not on the control-plane.
3. APISIX route 1003 (`/realtime/*`) and 2011 (`/v1/websockets/*`) can be
   re-pointed from `component: controlPlane` to the new
   `component: eventGatewayTransport` without contract changes.

## Non-goals

- **Kafka consumer fan-out into WS subscribers.** That belongs to F2; the
  transport in this proposal only handles the WS *upgrade* and the
  initial validation cycle, then hands the session to the F2 binary
  (which already consumes the B2 library).
- **Replacing the validator package.** The action handlers and transport
  call into the existing `validateEventPublicationRequest` /
  `validateEventSubscriptionRequest` / `buildTopicMetadataExposure`
  exports. Validators stay pure.
- **Session durability across pod restart.** Sessions remain ephemeral
  here; persistence is tracked as F2 follow-up.

## Placement: actions vs. transport

The capability has two distinct latency classes:

- **Short-lived, idempotent, request/response:** publish, topic metadata,
  subscription handshake. These suit OpenWhisk-style action handlers —
  same pattern used by F3 (`services/webhook-engine/actions/*`) and H1.
- **Long-lived, stateful, connection-bound:** WS upgrade, SSE writer,
  heartbeat. These do not fit OpenWhisk; they need a long-running
  Fastify process.

So this change creates two artifacts in parallel:

```
services/event-gateway/
  src/                  # existing validators (unchanged)
  actions/              # NEW — OpenWhisk-action handlers
    publish.mjs
    subscribe.mjs
    topic-metadata.mjs
  transport/            # NEW — Fastify long-lived server
    server.mjs
    routes/
      healthz.mjs
      metrics.mjs
      ws-upgrade.mjs
```

## Kafka producer wiring

Reuse `services/adapters/src/kafka-admin.mjs`. The action handler:

```
async function main(params) {
  const validated = validateEventPublicationRequest({
    context: params.context,
    topic: params.topic,
    request: params.request,
  });
  if (!validated.ok) {
    return { status: 400, body: { violations: validated.violations } };
  }
  const producer = await getProducer(); // singleton from kafka-admin
  await producer.send({
    topic: validated.normalized.topicRef,
    messages: [{ value: JSON.stringify(validated.normalized.envelope) }],
  });
  return { status: 202, body: { accepted: true, topicRef: validated.normalized.topicRef } };
}
```

Producer initialisation lives inside the action handler module (lazy,
per-cold-start). Connection pooling is the adapter's responsibility.

## Transport vs. APISIX

APISIX terminates TLS, performs JWT auth (via the gateway's plugin
config), and proxies the upgrade. The transport binary:

- Listens on `:8080`, exposes `/healthz/{live,ready}` and `/metrics`.
- Accepts `Upgrade: websocket` and hands the upgraded socket to the F2
  session manager (already in `services/realtime-gateway/src/`).
- Emits `in_falcone_event_gateway_{active_ws_connections,
  active_sse_streams, publish_total, backpressure_rejections_total}`.

The new APISIX upstream `component: eventGatewayTransport` is declared
in `services/gateway-config/routes/event-gateway-routes.yaml` and
materialised by `charts/in-falcone/values.yaml` (a follow-up Helm PR
once this change lands). Routes 1003 and 2011 retarget at that PR.

## Out-of-scope migrations

The F2 chart (`charts/realtime-gateway/`) is a separate capability and
is addressed by `complete-f2-chart-wiring` and
`complete-f2-transport-binary-and-handler`. This change deliberately
does not couple to it; the action handlers here can run against the
existing controlPlane upstream while F2 is being completed.
