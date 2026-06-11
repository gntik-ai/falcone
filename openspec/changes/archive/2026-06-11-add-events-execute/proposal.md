## Why

`services/adapters/src/kafka-admin.mjs::buildKafkaAdminAdapterCall` builds only
topic-admin/ACL policy — there is no executable produce/consume plan and no `kafkajs`
import anywhere in the adapter layer. Every `POST /v1/events/...publish` and
`GET /v1/events/...messages` call had no code path that could reach a Kafka broker.
This change adds the events executor — `createEventsExecutor` / `executeEvents` in
`apps/control-plane/src/runtime/events-executor.mjs` — and wires the four workspace-
scoped HTTP routes in `server.mjs`. Tenant isolation is structural: every logical topic
maps to a per-workspace physical topic `evt.<workspaceId>.<topic>`, so a workspace can
only ever produce to, consume from, or list its own topics.

## What Changes

- `apps/control-plane/src/runtime/events-executor.mjs` — `createEventsExecutor({brokers})` + `executeEvents(params)` using `kafkajs`; operations: `create_topic`, `list_topics`, `publish`, `consume` (poll).
- `apps/control-plane/src/runtime/server.mjs` — four workspace-scoped routes wired via `runEvents`: `GET/POST /v1/events/workspaces/{wid}/topics`, `POST .../topics/{topic}/publish`, `GET .../topics/{topic}/messages`.
- `apps/control-plane/src/runtime/main.mjs` — instantiates `createEventsExecutor` when `KAFKA_BROKERS` is set; calls `eventsExecutor.close()` on shutdown.
- `package.json` — `kafkajs` added as a dependency.
- Tests (real Redpanda): `tests/env/executor/events-executor.test.mjs` + `tests/env/executor/run-events.sh` — 5/5 green.

## Capabilities

### New Capabilities

### Modified Capabilities

- `events`: Kafka produce/consume/topic-management operations are now executed via the real `kafkajs` driver with per-workspace physical-topic prefix isolation; previously only topic-admin/ACL policy was produced, with no executor.

## Impact

- `apps/control-plane/src/runtime/events-executor.mjs` — new file (executor).
- `apps/control-plane/src/runtime/server.mjs` — four events routes added (`evt` pattern, `runEvents` helper).
- `apps/control-plane/src/runtime/main.mjs` — conditional `createEventsExecutor` initialization and shutdown hook.
- `services/adapters/src/kafka-admin.mjs::buildKafkaAdminAdapterCall` — reused unchanged as policy source; executor does not call it.
- `tests/env/executor/events-executor.test.mjs` + `tests/env/executor/run-events.sh` — real-Kafka proof (5/5 green).
- `package.json` — `kafkajs` driver added as a dependency.
