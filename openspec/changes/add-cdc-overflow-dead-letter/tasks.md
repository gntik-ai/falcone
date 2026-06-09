## 1. Add Failing Black-Box Tests

- [ ] 1.1 Add test `bbx-cdc-overflow-no-silent-drop` to `tests/blackbox/` that instantiates `KafkaChangePublisher` with `maxEventsPerSecond=1` and `overflowBufferSize=1`, publishes three events, and asserts no event is silently discarded — each event either appears in the primary topic, the overflow buffer, or the DLQ topic
- [ ] 1.2 Add test `bbx-cdc-dlq-tenant-namespace` that verifies the DLQ topic name is `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq` and never omits the `tenantId` or `workspaceId` segments
- [ ] 1.3 Add test `bbx-cdc-overflow-drain` that confirms overflow-buffered events are published to the primary topic (before the next live event) once rate capacity recovers
- [ ] 1.4 Confirm all three tests fail (red) against the current unpatched code before proceeding

## 2. Implement Overflow Buffer

- [ ] 2.1 Add `PG_CDC_OVERFLOW_BUFFER_SIZE` env-var read in `KafkaChangePublisher` constructor (default `256`); add `this.overflowBuffers = new Map()` keyed by `tenantId:workspaceId`
- [ ] 2.2 In `publish`, when `_allow` returns false: enqueue the event (as the already-constructed `CaptureChangeEvent`) into `this.overflowBuffers.get(key)` if buffer depth < `overflowBufferSize`; increment `pg_cdc_events_overflow_buffered_total`
- [ ] 2.3 In `publish`, when `_allow` returns false AND the overflow buffer is full: proceed to the DLQ path (Task 3)
- [ ] 2.4 In `publish`, when `_allow` returns true: before sending the live event, drain the overflow buffer for the current composite key (batch-send buffered events to the primary topic, then clear the buffer)

## 3. Implement DLQ Path

- [ ] 3.1 Add a `_deriveDlqTopic(captureConfig)` helper that returns `` `${deriveTopic({ namespace: process.env.PG_CDC_KAFKA_TOPIC_PREFIX, tenantId: captureConfig.tenant_id, workspaceId: captureConfig.workspace_id })}.dlq` ``
- [ ] 3.2 In `publish`, when the overflow buffer is full: send the event to the DLQ topic via `this.producer.send`; increment `pg_cdc_events_dlq_total` with `{ tenant_id, workspace_id }` labels
- [ ] 3.3 Emit a structured audit event `{ type: 'console.pg-cdc.overflow', tenantId, workspaceId, lsn, committedAt }` to the `console.pg-cdc.overflow` topic on DLQ publish

## 4. Coverage

- [ ] 4.1 Add test `bbx-cdc-overflow-metrics` that verifies `pg_cdc_events_overflow_buffered_total` increments on buffer enqueue and `pg_cdc_events_dlq_total` increments on DLQ publish
- [ ] 4.2 Add test `bbx-cdc-overflow-audit-event` that verifies a structured audit event with the correct `tenantId`/`workspaceId` is emitted when an event reaches the DLQ

## 5. Verify

- [ ] 5.1 Confirm all tests from Tasks 1 and 4 pass (green)
- [ ] 5.2 Run `bash tests/blackbox/run.sh`
