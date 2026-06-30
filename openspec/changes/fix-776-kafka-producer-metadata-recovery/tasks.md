## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #776 acceptance criteria:
  - Requirement: The system SHALL accept publish to an existing healthy workspace topic and return
    success (`202`), recovering producer cluster metadata as needed; it SHALL NOT return
    `502 PUBLISH_FAILED "does not host this topic-partition"` for a topic the broker is actually
    leading.
  - Scenario: WHEN a tenant owner publishes to an existing topic whose partition has a live leader,
    THEN publish is accepted (`202`), not `502 PUBLISH_FAILED`.
  - Scenario: WHEN a tenant owner creates a topic, THEN creation succeeds deterministically, not
    intermittently `502` with "does not host this topic-partition".
- [x] 1.2 Confirm root cause from source:
  - `eventsTopicPublish` used cached `producerP`, called one `p.send(...)`, and converted any error
    directly to `502 PUBLISH_FAILED`.
  - `eventsProvisionTopic` used cached `adminP`, called one
    `createTopics(... waitForLeaders: true)`, and converted any error directly to
    `502 TOPIC_PROVISION_FAILED`.
  - Neither path reset/disconnected cached KafkaJS clients or retried after stale metadata/leader
    errors.
- [x] 1.3 Add a focused unit test that injects Kafka/store fakes and encodes the publish and topic
  creation recovery scenarios without requiring a live broker.

## 2. Fix

- [x] 2.1 Add stale Kafka metadata/leader error classification for KafkaJS protocol codes, error
  types, nested causes, and broker messages.
- [x] 2.2 Add bounded recovery helpers that disconnect/clear the cached producer or admin and retry
  the operation once with a fresh client.
- [x] 2.3 Apply the recovery helper to `eventsTopicPublish`, returning `202` when the retry succeeds
  and preserving `502 PUBLISH_FAILED` for non-stale or retry failures.
- [x] 2.4 Apply the recovery helper to `eventsProvisionTopic`, returning `201` when the retry
  succeeds and preserving `502 TOPIC_PROVISION_FAILED` for non-stale or retry failures.
- [x] 2.5 Treat `TOPIC_ALREADY_EXISTS` after a stale-metadata create retry as success so a create that
  reached Kafka before metadata converged can still complete the idempotent workspace topic mapping.

## 3. Wire / frontend / docs

- [x] 3.1 Assess contract impact: no public API shape, OpenAPI, SDK, route catalog, or frontend
  change is required because status codes and schemas are unchanged.
- [x] 3.2 Add `docs/reference/architecture/events-kafka-metadata-recovery.md` with the Events
  runtime's one-shot metadata recovery behavior.
- [x] 3.3 Materialize this OpenSpec change under
  `openspec/changes/fix-776-kafka-producer-metadata-recovery/`.

## 4. Verify

- [x] 4.1 Run focused metadata recovery unit test:
  `node --test tests/unit/kafka-handlers-metadata-recovery.test.mjs`.
- [x] 4.2 Run full unit suite: `npm run test:unit`.
- [x] 4.3 Run OpenSpec validation:
  `openspec validate fix-776-kafka-producer-metadata-recovery --strict`.
- [x] 4.4 Run `git diff --check`.
- [ ] 4.5 Deploy to local kind and verify against live URLs.
  Blocked in this run: the parent environment reports kube-context `default` pointing at a hosted
  API server, and `kind get clusters` reports no local kind clusters. This fix intentionally does not
  mutate any cluster or hosted URL.
