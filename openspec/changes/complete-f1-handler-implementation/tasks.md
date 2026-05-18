## 1. Failing tests proving the gap

- [ ] 1.1 [test] Add a contract test
      `tests/contracts/event-gateway-publish-handler.contract.test.mjs`
      that posts a valid publish envelope to the action handler entry
      point and asserts a 202 with `{accepted: true, topicRef, …}`.
      Today this fails because the handler does not exist.
- [ ] 1.2 [test] Add an integration test
      `tests/integration/event-gateway-transport.test.mjs` that opens
      `GET /healthz/ready` against the new transport binary and asserts
      a 200; also asserts `/metrics` exposes the four
      `EVENT_GATEWAY_REQUIRED_METRICS`.

## 2. Implementation

- [ ] 2.1 [impl] Create `services/event-gateway/actions/publish.mjs`
      with `main(params)` that calls `validateEventPublicationRequest`
      and, on `ok: true`, hands the normalised envelope to the Kafka
      producer adapter.
- [ ] 2.2 [impl] Create `services/event-gateway/actions/subscribe.mjs`
      with `main(params)` that calls `validateEventSubscriptionRequest`
      and persists the initial session row through the
      session-store adapter; return `202` with the session id.
- [ ] 2.3 [impl] Create `services/event-gateway/actions/topic-metadata.mjs`
      with `main(params)` that delegates to
      `buildTopicMetadataExposure` and returns `200`.
- [ ] 2.4 [impl] Create `services/event-gateway/transport/server.mjs`
      (Fastify) exposing `/healthz/{live,ready}`, `/metrics`, and the
      WebSocket upgrade path that the F2 binary will consume; emit the
      four required Prometheus metrics.
- [ ] 2.5 [impl] Wire the Kafka producer through
      `services/adapters/src/kafka-admin.mjs`; reuse the canonical
      topic resolution path the validator already calls.
- [ ] 2.6 [impl] Add `services/gateway-config/routes/event-gateway-routes.yaml`
      declaring the new upstream `component: eventGatewayTransport`;
      reference it from `apps/control-plane/src/events-admin.mjs`.

## 3. Validation

- [ ] 3.1 [docs] Update `services/event-gateway/src/README.md` to
      reflect that the package is no longer validators-only; cross-link
      to `actions/` and `transport/`.
- [ ] 3.2 [test] Run `corepack pnpm test:contracts -- event-gateway` and
      `openspec validate complete-f1-handler-implementation --strict`;
      both green before merge.
