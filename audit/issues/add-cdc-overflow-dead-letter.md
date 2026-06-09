# Per-workspace CDC overflow buffering / dead-letter

| Field | Value |
|---|---|
| Change ID | `add-cdc-overflow-dead-letter` |
| Capability | `change-data-capture` |
| Type | enhancement |
| Priority | P2 |
| OpenSpec change | `openspec/changes/add-cdc-overflow-dead-letter/` |

## Why

When a workspace's CDC event rate exceeds `PG_CDC_MAX_EVENTS_PER_SECOND` (default 1000/s), `KafkaChangePublisher.publish` silently discards the event and increments `pg_cdc_events_rate_limited_total` — the dropped change is gone with no recovery path. Downstream consumers (functions, realtime subscriptions, webhooks) receive no signal that events were dropped. The Mongo CDC bridge provides a durability contrast via `services/mongo-cdc-bridge/src/index.mjs::ResumeTokenStore`, demonstrating the platform's intent for exactly-once-ish CDC delivery. The silent-drop behaviour is an asymmetry and a data-integrity gap for the Postgres CDC path.

## What Changes

- Introduce a bounded per-workspace in-process overflow buffer (keyed by `tenantId:workspaceId`, size controlled by `PG_CDC_OVERFLOW_BUFFER_SIZE`, default 256) that absorbs rate-limited events instead of discarding them.
- When rate capacity recovers, drain the buffer before publishing the live event (preserving approximate ordering).
- When the buffer is full, route the excess event to a per-tenant/workspace dead-letter Kafka topic `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, derived via the existing `deriveTopic` helper with a `.dlq` suffix — preserving the tenant/workspace topic-namespacing invariant.
- Emit `pg_cdc_events_overflow_buffered_total` and `pg_cdc_events_dlq_total` metrics and a `console.pg-cdc.overflow` audit event (scoped by `tenantId`/`workspaceId`) on DLQ publish.
- No event is silently dropped; every rate-limited event is either buffered, drained to the primary topic, or published to the DLQ.

## Spec delta (EARS)

From `openspec/changes/add-cdc-overflow-dead-letter/specs/change-data-capture/spec.md`:

**The system SHALL** enqueue each rate-limited CDC event into a per-workspace bounded overflow buffer rather than discarding it, provided the buffer is not yet full.

**The system SHALL** publish any CDC event that would be dropped (rate-limited AND overflow buffer full) to the per-tenant, per-workspace dead-letter topic `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, preserving the tenant/workspace topic-namespacing invariant established by `deriveTopic`.

**The system SHALL NOT** discard a CDC event without first attempting the overflow buffer and, if that is full, the DLQ topic.

**The system SHALL** derive the DLQ topic name using the same tenant-and-workspace-scoped namespacing as the primary topic.

Key scenarios:
- Rate-limited event enters overflow buffer when capacity exists.
- Overflow buffer is drained when rate capacity recovers.
- DLQ topic name includes tenant and workspace segments (e.g. `console.ten_A.wrk_A.pg-changes.dlq`).
- DLQ publish increments `pg_cdc_events_dlq_total` and emits audit event.
- Every rate-limited event produces an observable outcome (buffer, DLQ, or metric+audit — never silent).
- DLQ topic derivation reuses `deriveTopic` with `.dlq` suffix; `tenantId` and `workspaceId` are unmodifiable.

## Tasks

From `openspec/changes/add-cdc-overflow-dead-letter/tasks.md`:

- [ ] 1.1 Add test `bbx-cdc-overflow-no-silent-drop` — assert no event is silently discarded when rate=1 and buffer=1
- [ ] 1.2 Add test `bbx-cdc-dlq-tenant-namespace` — assert DLQ topic name is `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`
- [ ] 1.3 Add test `bbx-cdc-overflow-drain` — assert buffered events are published to primary topic on recovery
- [ ] 1.4 Confirm all tests fail (red) against current code
- [ ] 2.1 Add `PG_CDC_OVERFLOW_BUFFER_SIZE` env var and `this.overflowBuffers` map to constructor
- [ ] 2.2 Enqueue rate-limited events into overflow buffer in `publish`; increment `pg_cdc_events_overflow_buffered_total`
- [ ] 2.3 Add full-buffer → DLQ fallback path in `publish`
- [ ] 2.4 Add drain-before-live-event logic in the allowed-tick path in `publish`
- [ ] 3.1 Add `_deriveDlqTopic(captureConfig)` helper using `deriveTopic` + `.dlq`
- [ ] 3.2 DLQ send + `pg_cdc_events_dlq_total` increment
- [ ] 3.3 Emit `console.pg-cdc.overflow` audit event on DLQ publish
- [ ] 4.1 Add test `bbx-cdc-overflow-metrics` — verify metric increments
- [ ] 4.2 Add test `bbx-cdc-overflow-audit-event` — verify scoped audit event on DLQ publish
- [ ] 5.1 Confirm all tests pass (green)
- [ ] 5.2 Run `bash tests/blackbox/run.sh`

## Acceptance criteria

- `bbx-cdc-overflow-no-silent-drop`: with `maxEventsPerSecond=1` and `overflowBufferSize=1`, three published events result in: one primary publish, one overflow-buffer enqueue (then drained to primary on next tick), one DLQ publish — zero silent discards.
- `bbx-cdc-dlq-tenant-namespace`: DLQ topic is always `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`; tenant/workspace segments are never omitted regardless of namespace override.
- `bbx-cdc-overflow-drain`: after a rate-limited burst, events are published to the primary topic in buffer order once capacity recovers.
- `pg_cdc_events_dlq_total` increments on each DLQ publish with `{ tenant_id, workspace_id }` labels.
- A structured `console.pg-cdc.overflow` audit event with correct `tenantId`/`workspaceId` is emitted on every DLQ publish.
- `bash tests/blackbox/run.sh` passes green.
- No change to primary CDC topic schema or `CaptureChangeEvent` format.

## Code evidence

- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish` — line 36: `return null` on rate-limit — silent drop, no buffer, no DLQ
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish` — line 36: `this.metricsCollector?.increment('pg_cdc_events_rate_limited_total', ...)` is the sole observable signal of the drop
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` — lines 26-29: existing `{tenantId}.{workspaceId}.pg-changes` namespacing to be reused for DLQ topic suffix
- `services/mongo-cdc-bridge/src/index.mjs::ResumeTokenStore` — durability contrast: Mongo CDC persists resume tokens; Postgres CDC has no equivalent recovery mechanism

## Resolution (OpenSpec)

```
/opsx:apply add-cdc-overflow-dead-letter
/opsx:verify add-cdc-overflow-dead-letter
bash tests/blackbox/run.sh
/opsx:archive add-cdc-overflow-dead-letter
```

Shorthand: `/implement-change add-cdc-overflow-dead-letter`

Optional real-stack validation: `/e2e-issue add-cdc-overflow-dead-letter`
