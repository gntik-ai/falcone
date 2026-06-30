# Change: fix-776-kafka-producer-metadata-recovery

## Why

Issue #776 is a confirmed Events/Kafka runtime bug in the kind control-plane handler.

`deploy/kind/control-plane/kafka-handlers.mjs` caches KafkaJS admin and producer clients at module
scope. When KafkaJS serves stale cluster metadata, a healthy workspace topic can fail publish with
`This server does not host this topic-partition`, and topic creation can intermittently fail while
leader metadata is converging. The handler currently performs one Kafka operation and maps the first
error directly to `502 PUBLISH_FAILED` or `502 TOPIC_PROVISION_FAILED`, so it never refreshes the
stale client metadata even though the broker may be leading the partition.

The issue acceptance criteria are:

- Requirement: The system SHALL accept publish to an existing healthy workspace topic and return
  success (`202`), recovering producer cluster metadata as needed; it SHALL NOT return
  `502 PUBLISH_FAILED "does not host this topic-partition"` for a topic the broker is actually
  leading.
- Scenario: WHEN a tenant owner publishes to an existing topic whose partition has a live leader,
  THEN publish is accepted (`202`), not `502 PUBLISH_FAILED`.
- Scenario: WHEN a tenant owner creates a topic, THEN creation succeeds deterministically, not
  intermittently `502` with "does not host this topic-partition".

## What Changes

- Detect KafkaJS stale topic metadata and leader errors, including `UNKNOWN_TOPIC_OR_PARTITION`,
  `LEADER_NOT_AVAILABLE`, `NOT_LEADER_FOR_PARTITION`, `KAFKAJS_METADATA_NOT_LOADED`, and the broker
  message `does not host this topic-partition`.
- On `eventsTopicPublish`, if producer send fails with a stale metadata/leader error, disconnect and
  clear the cached producer, create a fresh producer, retry the send once, and return the existing
  `202 accepted` response if the retry succeeds.
- On `eventsProvisionTopic`, if `admin.createTopics(... waitForLeaders: true)` fails with a stale
  metadata/leader error, disconnect and clear the cached admin, create a fresh admin, retry the
  create once, and continue to insert the workspace topic mapping if the retry succeeds.
- Treat `TOPIC_ALREADY_EXISTS` after a stale-metadata create retry as successful recovery, because
  the first create may have reached Kafka before leader metadata converged; the workspace topic
  mapping remains idempotent through `store.insertTopic`.
- Preserve existing behavior for non-stale Kafka failures: they still return the current
  `502 PUBLISH_FAILED` or `502 TOPIC_PROVISION_FAILED` response.
- Add test hooks for this handler so unit tests can inject Kafka/store fakes without a live broker or
  Postgres.
- Add focused unit coverage for the issue scenarios.
- Document the Events runtime's one-shot metadata recovery behavior in the public API surface
  architecture note.

## Impact

- Backend/runtime:
  - `deploy/kind/control-plane/kafka-handlers.mjs`
- Tests:
  - `tests/unit/kafka-handlers-metadata-recovery.test.mjs`
- Docs/OpenSpec:
  - `docs/reference/architecture/events-kafka-metadata-recovery.md`
  - this OpenSpec change under
    `openspec/changes/fix-776-kafka-producer-metadata-recovery/`
- Frontend/wire:
  - No request/response shape, status-code contract, OpenAPI, SDK, route catalog, or frontend change
    is required. The fix keeps the existing Events API semantics and only changes backend recovery
    before an error response is emitted.

## Non-Goals

- No cluster deployment or live broker validation in this run. The active environment is not a local
  `kind-*` context and no local kind clusters are available.
- No change to native Kafka security/authentication, topic naming, SSE consume behavior, or public
  Events endpoint shapes.
