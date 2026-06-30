# Events Kafka Metadata Recovery

The kind control-plane Events runtime keeps KafkaJS admin and producer clients cached so routine
topic operations do not reconnect on every request. Cached KafkaJS clients can hold stale broker
metadata after topic creation or leader changes, so the publish and topic-create paths include a
bounded recovery pass for stale metadata and leader errors.

For `POST /v1/events/topics/{resourceId}/publish`, if Kafka reports a stale topic-partition,
leader, or metadata-not-loaded error for the managed workspace topic, the runtime disconnects and
clears the cached producer, creates a fresh producer, and retries the send once. A successful retry
keeps the normal `202 accepted` response. Non-metadata failures, or a failed retry, keep the
standard `502 PUBLISH_FAILED` response.

For `POST /v1/events/workspaces/{workspaceId}/topics`, if `createTopics(..., waitForLeaders: true)`
returns the same stale metadata class, the runtime disconnects and clears the cached admin, creates
a fresh admin, and retries the topic creation once. A successful retry keeps the normal `201`
response. If the first create reached Kafka but the retry observes `TOPIC_ALREADY_EXISTS`, the
runtime treats the broker-side create as recovered and still writes the idempotent
`workspace_topics` mapping. Non-metadata failures, or a failed retry, keep the standard
`502 TOPIC_PROVISION_FAILED` response.

This recovery changes no public Events API shape. It only refreshes cached KafkaJS client metadata
before deciding that a healthy managed workspace topic has failed.
