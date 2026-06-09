## ADDED Requirements

### Requirement: Rate-limited CDC events MUST be held in a bounded overflow buffer before any discard

The system SHALL enqueue each rate-limited CDC event into a per-workspace bounded overflow buffer (keyed by `tenantId:workspaceId`) rather than discarding it, provided the buffer is not yet full.

#### Scenario: Rate-limited event enters overflow buffer when capacity exists

- **WHEN** a CDC event for workspace W under tenant T is rate-limited by `_allow` and the overflow buffer for `T:W` has not reached its capacity limit
- **THEN** the event is appended to the overflow buffer for `T:W`, `pg_cdc_events_overflow_buffered_total` is incremented, and no event data is lost

#### Scenario: Overflow buffer is drained when rate capacity recovers

- **WHEN** a subsequent CDC event for `T:W` passes the `_allow` check and the overflow buffer for `T:W` is non-empty
- **THEN** buffered events are published to the primary CDC topic before the live event, and the overflow buffer depth decreases accordingly

### Requirement: Overflow events that exceed buffer capacity MUST be routed to a DLQ topic

The system SHALL publish any CDC event that would be dropped (rate-limited AND overflow buffer full) to the per-tenant, per-workspace dead-letter topic `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, preserving the tenant/workspace topic-namespacing invariant established by `deriveTopic`.

#### Scenario: DLQ topic name includes tenant and workspace segments

- **WHEN** an overflow event is routed to the dead-letter topic for tenant `ten_A` and workspace `wrk_A` with prefix `console`
- **THEN** the Kafka topic name used is `console.ten_A.wrk_A.pg-changes.dlq` and no variant omitting `ten_A` or `wrk_A` is used

#### Scenario: DLQ publish increments observable counter

- **WHEN** a CDC event is published to the DLQ topic
- **THEN** `pg_cdc_events_dlq_total` is incremented with labels `{ tenant_id, workspace_id }` and a structured audit event scoped to `tenantId`/`workspaceId` is emitted to `console.pg-cdc.overflow`

### Requirement: No CDC event MUST be silently dropped when overflow infrastructure is available

The system SHALL NOT discard a CDC event without first attempting the overflow buffer and, if that is full, the DLQ topic; a silent discard (no metric, no DLQ record) is MUST NOT occur for any event that passes basic validity checks.

#### Scenario: Every rate-limited event produces an observable outcome

- **WHEN** a CDC event is rate-limited
- **THEN** exactly one of the following is true: (a) the event is in the overflow buffer, (b) the event has been published to the DLQ topic, or (c) `pg_cdc_events_dlq_total` has been incremented and an audit event emitted — and `pg_cdc_events_rate_limited_total` is NEVER the sole observable signal of the event's fate

### Requirement: DLQ topic MUST preserve tenant and workspace namespacing invariant

The system SHALL derive the DLQ topic name using the same tenant-and-workspace-scoped namespacing as the primary topic, ensuring the DLQ topic for a given workspace is only readable/writable within that tenant's namespace.

#### Scenario: DLQ topic derivation reuses deriveTopic with dlq suffix

- **WHEN** `KafkaChangePublisher` publishes an event to the dead-letter queue for a given `captureConfig`
- **THEN** the topic is derived as `deriveTopic({ namespace, tenantId, workspaceId }) + ".dlq"` and the `tenantId` and `workspaceId` components are always present and unmodifiable by any namespace override
