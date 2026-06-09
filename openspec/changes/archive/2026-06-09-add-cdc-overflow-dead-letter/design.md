## Context

`KafkaChangePublisher.publish` enforces a per-workspace 1-second sliding window via `_allow(workspaceId)`. On exceed, the event is dropped and only `pg_cdc_events_rate_limited_total` is incremented. There is no recovery path. The Mongo CDC bridge (`services/mongo-cdc-bridge/src/index.mjs::ResumeTokenStore`) persists resume tokens for durability, demonstrating the platform's intent to provide exactly-once-ish CDC delivery. The `deriveTopic` helper already encodes the tenant/workspace topic-namespacing invariant (`${tenantId}.${workspaceId}.pg-changes`); a DLQ topic is the natural extension of that pattern with a `.dlq` suffix.

## Goals / Non-Goals

**Goals:**
- Eliminate silent, unobservable CDC event loss on rate-limit overflow.
- Provide a bounded in-process buffer to absorb transient rate spikes.
- Route irrecoverable overflow to a per-tenant/workspace DLQ Kafka topic.
- Surface overflow depth and DLQ count as observable metrics and audit events.
- Preserve the `tenantId.workspaceId` topic-namespacing invariant for DLQ topics.

**Non-Goals:**
- Changing the rate-limit algorithm or the `maxEventsPerSecond` default.
- Implementing a DLQ consumer or replay mechanism (out of scope; DLQ is the durability boundary).
- Distributed rate limiting or coordination across multiple CDC bridge instances.
- Changing the primary CDC topic schema or the `CaptureChangeEvent` format.

## Decisions

**Decision: In-process overflow buffer (not an external queue).**
Rationale: Keeps the change self-contained within `KafkaChangePublisher`. An external queue (Redis, Kafka retry topic) would introduce a new dependency and operational complexity. The buffer is intentionally bounded (`PG_CDC_OVERFLOW_BUFFER_SIZE`) so memory impact is capped; events beyond the buffer cap go to the DLQ rather than accumulating in heap.

**Decision: DLQ topic derived from `deriveTopic` + `.dlq` suffix.**
Rationale: Reuses the established, tested helper and guarantees the `tenantId`/`workspaceId` namespace is always present. Operators who already consume `{prefix}.{tenantId}.{workspaceId}.pg-changes` can subscribe to the `.dlq` sibling with the same ACL pattern.

**Decision: Drain buffer before live event on each allowed tick.**
Rationale: Preserves approximate commit-order ordering: older buffered events should reach the consumer before a newer live event. Not strictly guaranteed (Kafka ordering is per-partition, not cross-message), but is the best-effort approach available in-process.

**Alternative considered:** Back-pressure to the replication slot (pause consumption). Rejected: pausing the replication slot stalls all workspaces on the same bridge instance, turning a per-workspace issue into a cross-tenant impact. The buffer + DLQ approach isolates the effect to the overflowing workspace.

## Risks / Trade-offs

**Risk:** Overflow buffer adds per-workspace heap usage up to `PG_CDC_OVERFLOW_BUFFER_SIZE * avg_event_size`.
**Mitigation:** Default buffer size (256) with average ~2 KB events = ~512 KB per active overflowing workspace. Operators can tune `PG_CDC_OVERFLOW_BUFFER_SIZE=0` to disable the buffer and route directly to DLQ. Document the memory model.

**Risk:** DLQ topic must be pre-created or auto-created; if auto-creation is disabled in the Kafka cluster, the first DLQ publish fails.
**Mitigation:** Emit a clear error metric/log on DLQ publish failure. The DLQ topic follows the same auto-create pattern as the primary topics. Document the requirement.

**Risk:** Drain-before-publish path in `publish` increases per-message latency when the buffer is non-empty.
**Mitigation:** Buffer drain is bounded by `PG_CDC_OVERFLOW_BUFFER_SIZE` entries per tick — worst-case one batch Kafka send. The live event is sent after the drain in the same call, so the replication slot is not stalled.

## Migration Plan

No schema or API changes. The feature is backward-compatible: existing deployments that never exceed the rate limit are unaffected. New environment variables (`PG_CDC_OVERFLOW_BUFFER_SIZE`) default to safe values. New Kafka topics are lazily created on first overflow. New metrics and audit events are additive. No data migration required.
