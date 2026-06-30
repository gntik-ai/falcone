## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #777 acceptance criteria:
  - Requirement: The system SHALL serve the routes the EventsConsole page calls, and the page's
    create-topic request SHALL use the request-body field the handler expects, so a tenant owner can
    list, create, publish to, and consume from event topics.
  - Scenario: WHEN a tenant owner opens `/console/events/data`
    (`GET /v1/events/workspaces/{ws}/topics`) THEN request resolves to a real handler, not
    `404 NO_ROUTE`.
  - Scenario: WHEN a tenant owner submits create-topic with a name THEN request body carries the
    field the handler reads and topic is created (`201`), not `400 VALIDATION_ERROR "topic name is
    required"`.
  - Scenario: WHEN a tenant owner publishes to / consumes from a topic via the page THEN
    `POST .../topics/{t}/publish` and `GET .../topics/{t}/messages` resolve to real handlers, not
    `404 NO_ROUTE`.
- [x] 1.2 Confirm root cause from source:
  - `routes.mjs` registered inventory/create/resource-id Events routes but not workspace-scoped
    list, logical-topic publish, or logical-topic messages.
  - `eventsProvisionTopic` reads `ctx.body.name`.
  - `eventsApi.ts` sent `{ topic, ...options }`.
  - `route-map.runtime.json` did not include the EventsConsole workspace routes.
- [x] 1.3 Add regression tests for the route table, route maps, workspace-scoped handlers, and
  console create-topic request body.

## 2. Fix

- [x] 2.1 Add workspace-scoped topic list handler returning `TopicRecord`-compatible items.
- [x] 2.2 Add workspace-scoped logical-topic publish handler with owner/admin enforcement and
  console `{ key?, value }` payload normalization.
- [x] 2.3 Add workspace-scoped logical-topic messages handler with bounded Kafka consumption and
  `{ items: [{ key, value, partition, offset, timestamp }] }` response shape.
- [x] 2.4 Register the three missing workspace-scoped routes in `routes.mjs`.
- [x] 2.5 Change the web-console Events API client to send create-topic bodies as `{ name,
  partitions }`.
- [x] 2.6 Keep the alternate control-plane runtime compatible with `{ name }` create-topic bodies
  while preserving `{ topic }` fallback behavior.

## 3. Wire / docs / OpenSpec

- [x] 3.1 Update `route-map.runtime.json` and `route-map.json`.
- [x] 3.2 Materialize this OpenSpec change with Events and web-console spec deltas.
- [x] 3.3 Add architecture documentation for EventsConsole workspace event routes.
- [x] 3.4 Run public API generation/validation and confirm whether generated artifacts stay
  unchanged.

## 4. Verify

- [x] 4.1 Run focused Node unit test:
  `node --test tests/unit/kafka-handlers-workspace-routes.test.mjs`.
- [x] 4.2 Run focused web-console service test:
  `pnpm --filter @in-falcone/web-console test -- eventsApi.test.ts`.
- [x] 4.3 Run focused existing metadata recovery unit test:
  `node --test tests/unit/kafka-handlers-metadata-recovery.test.mjs`.
- [x] 4.4 Run OpenSpec validation:
  `openspec validate fix-777-events-console-routes --strict`.
- [x] 4.5 Run public API checks:
  `npm run validate:public-api`, `npm run validate:openapi`, and `npm run generate:public-api`.
- [x] 4.6 Run `git diff --check`.
- [ ] 4.7 Deploy to local kind and verify against live URLs.
  Blocked in this run by instruction and environment: current Kubernetes context is non-kind and no
  kind clusters exist, so this change must not mutate any cluster.
