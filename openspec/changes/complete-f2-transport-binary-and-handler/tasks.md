## 1. Failing tests proving the gap

- [ ] 1.1 [test] Add an integration test
      `tests/integration/realtime-gateway-transport/healthz.test.mjs`
      that boots the new transport, queries `GET /healthz/ready` over
      HTTP, and asserts a 200 — today this fails because no transport
      exists.
- [ ] 1.2 [test] Add an integration test
      `tests/integration/realtime-gateway-transport/ws-upgrade.test.mjs`
      that performs a WebSocket upgrade to `/v1/workspaces/{ws}/realtime`
      with a valid JWT and asserts the session manager records an active
      session.

## 2. Implementation

- [ ] 2.1 [impl] Create `services/realtime-gateway/transport/server.mjs`
      (Fastify) wiring `validateToken`, `createSessionManager`,
      `checkScopes`, `parseFilter`, `evaluateFilter` from the existing
      B2 library; expose `/healthz/{live,ready}` and `/metrics`.
- [ ] 2.2 [impl] Add WS upgrade handler at
      `services/realtime-gateway/transport/routes/ws-upgrade.mjs`
      handling `Upgrade: websocket`, JWT auth, scope check, session
      registration.
- [ ] 2.3 [impl] Add SSE writer at
      `services/realtime-gateway/transport/routes/sse.mjs` for clients
      that cannot upgrade to WS.
- [ ] 2.4 [impl] Add Kafka consumer module at
      `services/realtime-gateway/transport/kafka-bridge.mjs` that
      consumes from canonical topics and fans out to matching active WS
      sessions using `guardEvent` and `evaluateFilter`.
- [ ] 2.5 [impl] Add OpenWhisk-style handler `actions/create-session.mjs`
      that implements `POST /v1/websockets/sessions` per
      `apps/control-plane/openapi/families/websockets.openapi.json:557-689`.
- [ ] 2.6 [impl] Add `services/realtime-gateway/Dockerfile` producing
      `ghcr.io/falcone/realtime-gateway`; add
      `.github/workflows/realtime-gateway-image.yml` building and
      publishing it on `main`.
- [ ] 2.7 [impl] Add
      `services/gateway-config/routes/realtime-gateway-routes.yaml`
      declaring upstream `component: realtimeGateway` and routes for
      `/v1/workspaces/*/realtime[/*]` and `GET /v1/events/subscribe` so
      the capability gates at
      `services/gateway-config/routes/capability-gated-routes.yaml:18-22`
      have real upstream targets.

## 3. Validation

- [ ] 3.1 [docs] Document the transport, image, and routing topology in
      `services/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:integration --
      realtime-gateway-transport` and `openspec validate
      complete-f2-transport-binary-and-handler --strict`; both green
      before merge.
