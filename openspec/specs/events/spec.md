# events Specification

## Purpose
TBD - created by archiving change add-events-execute. Update Purpose after archive.
## Requirements
### Requirement: Kafka produce and consume operations are executed via the real driver

The system SHALL execute `publish` and `consume` requests against the workspace's Kafka
broker via the `kafkajs` driver so that messages are durably produced to and polled from
real Kafka topics, not discarded or held in memory.

#### Scenario: Publish then consume returns the published messages

- **WHEN** a caller with a valid workspace identity publishes three messages to a topic
  via `POST /v1/events/workspaces/{wid}/topics/{topic}/publish` and then consumes via
  `GET /v1/events/workspaces/{wid}/topics/{topic}/messages`
- **THEN** the consume response contains all three messages with the correct keys and
  values, and the publish response reports `published: 3`

#### Scenario: Create topic provisions the physical topic on the broker

- **WHEN** a caller with a valid workspace identity creates a topic via
  `POST /v1/events/workspaces/{wid}/topics` with `{topic: "orders"}`
- **THEN** the physical topic `evt.<wid>.orders` is created on the broker and the
  response returns `{topic: "orders", created: true}`

### Requirement: Per-workspace physical-topic prefix enforces structural isolation

The system SHALL map every logical topic name to a physical Kafka topic
`evt.<workspaceId>.<topic>` so that a workspace can only ever produce to, consume from,
or list topics whose physical name begins with its own prefix, regardless of the topic
name supplied by the caller.

#### Scenario: Workspace B cannot read workspace A's stream

- **WHEN** workspace A publishes messages to its `orders` topic (physical:
  `evt.<wsA>.orders`) and workspace B consumes from its own `orders` topic (physical:
  `evt.<wsB>.orders`)
- **THEN** workspace B receives zero messages, because the two physical topics are
  distinct and the prefix ensures no cross-workspace access

#### Scenario: List topics returns only the calling workspace's topics

- **WHEN** two workspaces each have topics on the same broker and workspace A calls
  `GET /v1/events/workspaces/{widA}/topics`
- **THEN** the response contains only workspace A's topics; workspace B's topics do not
  appear in the list

### Requirement: list_topics returns logical names with the physical prefix stripped

The system SHALL strip the `evt.<workspaceId>.` prefix from every topic name before
returning it in the list response so that callers see only logical topic names and the
internal physical-prefix convention is never exposed.

#### Scenario: Listed topic names contain no physical prefix

- **WHEN** a caller lists topics for workspace W and the broker holds the physical topic
  `evt.<wid>.orders`
- **THEN** the response contains `{topic: "orders"}` and no returned item's `topic`
  field starts with `evt.`

### Requirement: Missing workspace identity returns 401

The system SHALL return HTTP 401 for any events request that arrives without a
resolvable tenant identity (no `x-tenant-id` header and no valid API key), so that
unauthenticated callers cannot produce to, consume from, or list any topic.

#### Scenario: Request with no identity is rejected with 401

- **WHEN** a caller sends a list-topics request to an events endpoint without providing
  any tenant identity (no JWT headers, no API key)
- **THEN** the response status is 401 and no topic data is returned

### Requirement: Broker errors are returned as sanitized HTTP 502 responses

The system SHALL catch all `kafkajs` broker errors, log the raw error server-side with
an opaque correlation reference, and return only HTTP 502 with a stable error `code`
without exposing broker message text, topic names, or tenant data to the caller.

#### Scenario: Unhandled broker error returns 502 with opaque code

- **WHEN** the `kafkajs` driver raises an unexpected error during a produce, consume, or
  admin operation
- **THEN** the response status is 502, the body contains `code: "KAFKA_ERROR"`, and no
  broker message text or internal topic name appears in the response

### Requirement: Events executor is disabled when no broker is configured

The system SHALL return HTTP 501 for any events request when `KAFKA_BROKERS` is not set
so that deployments without a Kafka cluster fail fast rather than silently.

#### Scenario: Events route returns 501 when executor is not configured

- **WHEN** the control-plane starts without `KAFKA_BROKERS` set and a caller requests
  any events endpoint
- **THEN** the response status is 501 with `code: "EVENTS_DISABLED"`

