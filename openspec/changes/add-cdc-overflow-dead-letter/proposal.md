## Why

When a workspace's CDC event rate exceeds `PG_CDC_MAX_EVENTS_PER_SECOND` (default 1000 events/second), `KafkaChangePublisher.publish` silently discards the event and increments `pg_cdc_events_rate_limited_total`. There is no overflow buffer, no dead-letter topic, and no audit event — the change is permanently and irrecoverably lost. Downstream consumers (functions, realtime subscriptions, webhooks) receive no signal that events were dropped. The Mongo CDC path provides a durability contrast: `services/mongo-cdc-bridge/src/index.mjs::ResumeTokenStore` persists resume tokens so the bridge can recover after an interruption without losing events. The silent-drop behaviour on the Postgres side is an asymmetry and a data-integrity gap.

## What Changes

- Introduce a bounded per-workspace in-process overflow buffer (configurable via `PG_CDC_OVERFLOW_BUFFER_SIZE`, default 256 events per composite `tenantId:workspaceId` key) that absorbs rate-limited events instead of discarding them immediately.
- On each tick where `_allow` permits capacity, drain the overflow buffer for the current workspace and publish buffered events before the incoming live event, preserving approximate ordering.
- When the overflow buffer for a workspace is itself full (back-pressure exhausted), route the excess event to a dead-letter Kafka topic named `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, constructing the topic name via the same `deriveTopic` helper (with a `.dlq` suffix convention) to preserve the tenant/workspace topic-namespacing invariant.
- Emit a `pg_cdc_events_overflow_buffered_total` metric (gauge: current buffer depth) and a `pg_cdc_events_dlq_total` counter on DLQ publish so operators and tenants can detect and alert on loss.
- Emit a structured audit event (`console.pg-cdc.overflow`) when an event is routed to the DLQ, scoped by `tenantId` and `workspaceId`.
- No event is silently dropped; every rate-limited event either enters the overflow buffer or the DLQ.

## Capabilities

### New Capabilities

- `change-data-capture`: Rate-overflow events are held in a bounded buffer and drained when capacity recovers; events that cannot be buffered are routed to a per-tenant/workspace DLQ topic rather than silently discarded, with an observable metric and audit event.

### Modified Capabilities

## Impact

- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` — drives drain-on-allow logic
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish` — overflow buffer enqueue / DLQ fallback path
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` — reused for DLQ topic derivation (`.dlq` suffix)
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` — new `overflowBuffers` map (bounded per composite key); new `PG_CDC_OVERFLOW_BUFFER_SIZE` env var read in constructor
- Metrics: `pg_cdc_events_overflow_buffered_total`, `pg_cdc_events_dlq_total` added to `metricsCollector` calls
