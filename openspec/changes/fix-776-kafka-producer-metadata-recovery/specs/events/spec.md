# events — spec delta for fix-776-kafka-producer-metadata-recovery

## MODIFIED Requirements

### Requirement: Events publish and topic creation recover stale Kafka metadata

The system SHALL accept publish to an existing healthy workspace topic and return success (`202`),
recovering producer cluster metadata as needed; it SHALL NOT return `502 PUBLISH_FAILED` with
`does not host this topic-partition` for a topic the broker is actually leading.

The system SHALL create workspace event topics deterministically when the caller is authorized and
the broker can create or already has created the managed topic, recovering admin cluster metadata
and leader state as needed; it SHALL NOT return intermittent `502 TOPIC_PROVISION_FAILED` responses
with stale topic-partition or leader metadata errors when a bounded reconnect and retry succeeds.

#### Scenario: Publish to an existing topic with a live leader

- **WHEN** a tenant owner publishes to an existing topic whose partition has a live leader
- **THEN** publish is accepted (`202`)
- **AND THEN** the response is not `502 PUBLISH_FAILED`

#### Scenario: Create a topic while Kafka leader metadata converges

- **WHEN** a tenant owner creates a topic
- **THEN** creation succeeds deterministically
- **AND THEN** the response is not intermittently `502` with "does not host this topic-partition"
