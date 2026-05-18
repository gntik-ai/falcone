# Design — complete-f2-transport-binary-and-handler

## Goals

1. The chart's `image: ghcr.io/falcone/realtime-gateway:latest` resolves
   to an artefact built from this repository.
2. The B2 authorization library
   (`services/realtime-gateway/src/`) has a runnable consumer: WS
   upgrade, SSE, Kafka fan-out.
3. The OpenAPI surface for `POST /v1/websockets/sessions` is owned by a
   process whose source can be inspected; the
   `x-owning-service: event_gateway` mis-attribution
   (`apps/control-plane/openapi/families/websockets.openapi.json:684`)
   becomes correctable by a sibling change.
4. The capability-gated paths
   (`services/gateway-config/routes/capability-gated-routes.yaml:18-22`)
   gain real APISIX upstream targets.

## Non-goals

- **Chart wiring.** Adding the `Service`, populating the Secret, adding
  the umbrella's `component: realtimeGateway` entry, and re-pointing
  routes 1003/2011 all belong to `complete-f2-chart-wiring`.
- **Per-route URL hygiene.** Routes 2014/2015 misnaming and the
  `x-owning-service` correction are in `fix-f2-route-misalignment`.
- **Pod resilience.** Probes, resources, replicas, KEYCLOAK_CLIENT_ID
  fix are in `harden-f2-pod-resilience`.

## Where the WS server lives

```
services/realtime-gateway/
  src/                       # existing B2 library (unchanged)
    auth/validateToken.mjs
    session/createSessionManager.mjs
    scopes/checkScopes.mjs
    filter/parseFilter.mjs   evaluateFilter.mjs
    audit/publishAuthDecision.mjs
    config/env.mjs
  transport/                 # NEW — Fastify long-lived process
    server.mjs
    routes/
      ws-upgrade.mjs
      sse.mjs
      healthz.mjs
      metrics.mjs
    kafka-bridge.mjs
  actions/                   # NEW — OpenWhisk-style HTTP handlers
    create-session.mjs
    get-session.mjs
  Dockerfile
  package.json               # add "start": "node transport/server.mjs"
```

The transport is one process. JWT auth runs on every WS upgrade and on
each session-bound HTTP route; `validateToken` is the only entry point.
The session manager is in-memory per pod (B2 caveat — durability is a
separate F2 follow-up). Kafka fan-out runs in the same process: one
consumer group per pod, each pod handles a partition slice.

## Image build / publish

`services/realtime-gateway/Dockerfile`:
- multi-stage; production stage uses `node:20-alpine`,
- `COPY src/ transport/ actions/ package.json pnpm-lock.yaml`,
- `RUN corepack pnpm install --prod --frozen-lockfile`,
- `CMD ["node", "transport/server.mjs"]`.

`.github/workflows/realtime-gateway-image.yml` triggers on `main` for
changes under `services/realtime-gateway/**` and publishes
`ghcr.io/falcone/realtime-gateway:{sha,latest}`. The chart's
`image.tag` defaults stay as `latest`; per-environment overlays pin
shas.

## Route declarations

`services/gateway-config/routes/realtime-gateway-routes.yaml` declares:

```yaml
upstreams:
  - name: realtimeGateway
    component: realtimeGateway
    port: 8080
routes:
  - uri: /v1/workspaces/*/realtime
    enableWebsocket: true
    upstream: realtimeGateway
    capability: realtime
  - uri: /v1/workspaces/*/realtime/*
    enableWebsocket: true
    upstream: realtimeGateway
    capability: realtime
  - uri: /v1/events/subscribe
    methods: [GET]
    upstream: realtimeGateway
    capability: realtime
```

These are picked up by the chart-wiring change to populate APISIX
routes in `charts/in-falcone/values.yaml`.

## Cut-over sequence with sibling proposals

1. **This change** lands the binary, Dockerfile, CI, route declarations.
2. **`complete-f2-chart-wiring`** adds the `Service` to
   `charts/realtime-gateway/templates/`, declares `realtimeGateway` as
   an umbrella upstream component, re-points routes 1003/2011 from
   `controlPlane` to `realtimeGateway`, references the new ESO
   `Secret` source.
3. **`fix-f2-route-misalignment`** corrects `x-owning-service` and
   renames routes 2014/2015 to drop the `/v1/realtime/` prefix.
4. **`harden-f2-pod-resilience`** tightens probes, resources, replicas,
   and KEYCLOAK_INTROSPECTION_CLIENT_ID.

This change can land before any of (2)/(3)/(4) without breaking the
running system because no umbrella route currently targets the
realtime-gateway upstream — the binary becomes available, untrusted,
until the chart wiring catches up.
