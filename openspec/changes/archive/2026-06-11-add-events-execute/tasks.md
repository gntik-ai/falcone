## Implementation status (Phase 1 — DONE)

Implemented + proven against real Kafka (Redpanda) via
`bash tests/env/executor/run-events.sh`:
- `create_topic`, `list_topics`, `publish`, `consume` (poll) executed via `kafkajs`
  in `apps/control-plane/src/runtime/events-executor.mjs`; per-workspace physical-topic
  prefix isolation (`evt.<workspaceId>.<topic>`); logical names returned on list.
- HTTP routes wired in `apps/control-plane/src/runtime/server.mjs`:
  `GET/POST /v1/events/workspaces/{wid}/topics`,
  `POST .../topics/{topic}/publish`,
  `GET .../topics/{topic}/messages`.
- `main.mjs` instantiates the executor when `KAFKA_BROKERS` is set and closes it on
  SIGTERM/SIGINT.
- `package.json` adds `kafkajs` as a dependency.
- Tests (5/5): create topic, publish+consume round-trip (3 msgs), workspace B cannot
  read workspace A's stream (0 msgs), workspace-scoped list_topics (logical names only),
  401 on missing identity.

DEFERRED: SSE/WebSocket streaming; consumer group management and offset commit; topic
ACLs/config via the executor; schema registry integration.

## 1. Baseline

- [ ] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] T02 Confirm `openspec validate add-events-execute --strict` passes

## 2. Black-box tests (write first; must be red before implementation)

- [ ] T03 Write failing test `bbx-events-create-list`: create a topic via
  `POST /v1/events/workspaces/{wid}/topics`, then list via `GET` on the same path;
  assert the topic appears with its logical name (no `evt.` prefix)
- [ ] T04 Write failing test `bbx-events-publish-consume`: publish three messages to a
  topic, then consume via `GET .../topics/{topic}/messages`; assert all three messages
  are returned with correct keys and values
- [ ] T05 Write failing test `bbx-events-cross-workspace-isolation`: workspace A
  publishes three messages to topic `orders`; workspace B consumes from its own `orders`
  topic; assert workspace B receives zero messages
- [ ] T06 Write failing test `bbx-events-list-logical-names`: list topics for workspace
  A; assert no returned topic name starts with `evt.`
- [ ] T07 Write failing test `bbx-events-no-identity-401`: list topics with no identity
  headers and no API key; assert HTTP 401
- [ ] T08 Write failing test `bbx-events-disabled-501`: request to events endpoint when
  `KAFKA_BROKERS` is unset; assert HTTP 501 with `code: "EVENTS_DISABLED"`
- [ ] T09 Confirm all T03–T08 are red against the current codebase before implementation

## 3. Executor implementation

- [ ] T10 Implement `createEventsExecutor({brokers})` in
  `apps/control-plane/src/runtime/events-executor.mjs`:
  - Construct `Kafka` client with `clientId: "in-falcone-control-plane"`, no-op log level
  - Lazy-connect singleton producer and admin; expose `close()` for shutdown
  - Guard: if `!identity.tenantId` throw 401 `IDENTITY_MISSING`; if `!workspaceId` throw
    400 `WORKSPACE_MISSING`
  - Validate topic and workspace name against `NAME` pattern; throw 400 on invalid
- [ ] T11 Implement `list_topics` branch: `admin().listTopics()` filtered by
  `evt.<workspaceId>.` prefix; strip prefix before returning logical names
- [ ] T12 Implement `create_topic` branch: `admin().createTopics()` with physical topic
  `evt.<workspaceId>.<topic>`; return `{topic: logical, created: bool}`
- [ ] T13 Implement `publish` branch: `producer().send()` with physical topic; map
  `messages` array to `{key, value}` pairs; return `{topic, published, partitions}`
- [ ] T14 Implement `consume` branch: create ephemeral consumer with random group ID;
  subscribe from beginning; poll until `maxMessages` or `timeoutMs`; disconnect; return
  `{topic, messages}` with `{key, value, offset, timestamp}` per message
- [ ] T15 Catch all untagged `kafkajs` errors; re-throw as
  `{statusCode: 502, code: "KAFKA_ERROR"}` without leaking the raw broker message

## 4. Route wiring

- [ ] T16 Confirm `runEvents(eventsExecutor, params, successStatus)` helper exists in
  `server.mjs`; returns 501 `EVENTS_DISABLED` when `eventsExecutor` is falsy
- [ ] T17 Confirm `GET /v1/events/workspaces/{wid}/topics` wired to `list_topics`
- [ ] T18 Confirm `POST /v1/events/workspaces/{wid}/topics` wired to `create_topic`
- [ ] T19 Confirm `POST /v1/events/workspaces/{wid}/topics/{topic}/publish` wired to
  `publish`
- [ ] T20 Confirm `GET /v1/events/workspaces/{wid}/topics/{topic}/messages` wired to
  `consume`
- [ ] T21 Confirm `main.mjs` instantiates `createEventsExecutor` when `KAFKA_BROKERS`
  is set and calls `eventsExecutor.close()` on SIGTERM/SIGINT

## 5. Integration verification

- [ ] T22 Run `bash tests/env/executor/run-events.sh`; confirm all 5 real-Kafka tests
  pass
- [ ] T23 Run `bash tests/blackbox/run.sh`; confirm T03–T08 pass (green) and existing
  tests are unaffected
- [ ] T24 Run `openspec validate add-events-execute --strict`
