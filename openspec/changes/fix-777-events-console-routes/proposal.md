# Change: fix-777-events-console-routes

## Why

Issue #777 is a confirmed web-console/backend contract bug in the Events data page.

`EventsConsole` calls workspace-scoped topic routes:

- `GET /v1/events/workspaces/{workspaceId}/topics`
- `POST /v1/events/workspaces/{workspaceId}/topics`
- `POST /v1/events/workspaces/{workspaceId}/topics/{topic}/publish`
- `GET /v1/events/workspaces/{workspaceId}/topics/{topic}/messages`

The kind control-plane route table registered only the inventory route, the create-topic route, and
resource-id topic routes. Topic list, logical-topic publish, and logical-topic messages fell through
to `404 NO_ROUTE`. The create-topic route existed, but the console sent `{ topic }` while the local
handler reads `ctx.body.name`, so a tenant owner hit `400 VALIDATION_ERROR "topic name is required"`.

The issue acceptance criteria are:

- Requirement: The system SHALL serve the routes the EventsConsole page calls, and the page's
  create-topic request SHALL use the request-body field the handler expects, so a tenant owner can
  list, create, publish to, and consume from event topics.
- Scenario: WHEN a tenant owner opens `/console/events/data`
  (`GET /v1/events/workspaces/{ws}/topics`) THEN request resolves to a real handler, not
  `404 NO_ROUTE`.
- Scenario: WHEN a tenant owner submits create-topic with a name THEN request body carries the field
  the handler reads and topic is created (`201`), not `400 VALIDATION_ERROR "topic name is required"`.
- Scenario: WHEN a tenant owner publishes to / consumes from a topic via the page THEN
  `POST .../topics/{t}/publish` and `GET .../topics/{t}/messages` resolve to real handlers, not
  `404 NO_ROUTE`.

## What Changes

- Add kind control-plane local handlers for workspace-scoped topic list, logical-topic publish, and
  logical-topic messages.
- Register the workspace-scoped list, publish, and messages routes in `routes.mjs`.
- Keep `route-map.runtime.json` and `route-map.json` in sync with the route registrations.
- Change the web-console Events API client to send create-topic bodies as `{ name, partitions }`.
- Keep the alternate control-plane runtime compatible by accepting `name` for workspace topic
  creation while preserving the existing `topic` fallback.
- Return topic-list records with the fields the EventsConsole consumes plus resource metadata:
  `{ topic, partitions, resourceId, topicName }`.
- Normalize console publish bodies `{ key?, value }` onto the existing Kafka publish payload
  semantics without removing resource-id publish support.
- Add focused unit and web-console service tests using injected store/Kafka fakes, so no live broker
  or Kubernetes cluster is required.
- Add architecture documentation for the EventsConsole workspace event routes.

## Impact

- Backend/runtime:
  - `deploy/kind/control-plane/kafka-handlers.mjs`
  - `deploy/kind/control-plane/routes.mjs`
  - `apps/control-plane/src/runtime/server.mjs`
  - `apps/control-plane/src/runtime/events-executor.mjs`
- Frontend:
  - `apps/web-console/src/services/eventsApi.ts`
- Route metadata:
  - `deploy/kind/control-plane/route-map.runtime.json`
  - `deploy/kind/control-plane/route-map.json`
- Tests:
  - `tests/unit/kafka-handlers-workspace-routes.test.mjs`
  - `apps/web-console/src/services/eventsApi.test.ts`
- Docs/OpenSpec:
  - `docs/reference/architecture/events-console-workspace-routes.md`
  - this OpenSpec change under `openspec/changes/fix-777-events-console-routes/`

## Non-Goals

- No Kubernetes deployment or live browser verification in this run. The provided environment is not
  a safe local kind context, and no kind clusters exist.
- No change to the public resource-id Events routes (`/v1/events/topics/{resourceId}/*`) beyond
  sharing the same publish helper and preserving their request semantics.
- No generated OpenAPI change is expected: the missing routes are the console/kind workspace routes
  already modeled by the alternate runtime path rather than the published resource-id Events API.
