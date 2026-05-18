## Why

The `mongo-cdc-bridge` audit-callback is awaited inside the change-stream
loop, so any Postgres slowdown stalls capture. From
`openspec/audit/cap-e2-mongo-cdc-bridge.md`:

- **B9** (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:52,62`) —
  `await this.auditCallback(...)` is invoked synchronously inside `_run`.
  The default audit callback in `services/mongo-cdc-bridge/src/index.mjs:29`
  runs `pool.query(...)` to insert into `mongo_capture_audit_log`. A slow
  Postgres write adds latency to every oversized event and every stream
  invalidation; a failing Postgres throws and triggers a reconnect cycle
  even though Mongo is healthy.
- **G15** — same as B9, called out as a gap. Includes the observation
  that there is no async-fire-and-forget option.

## What Changes

- Replace the synchronous `await auditCallback(...)` with an in-process
  bounded queue: `auditEmitter.enqueue({eventType, captureConfig, data})`.
  A dedicated `AuditWriter` drains the queue with backpressure
  (`MONGO_CDC_AUDIT_QUEUE_MAX` default 10 000); on overflow the writer
  drops the oldest entry and increments
  `mongo_cdc_audit_dropped_total`.
- A retry policy on the writer: failed Postgres inserts retry with
  exponential backoff up to
  `MONGO_CDC_AUDIT_RETRY_MAX_SECONDS` (default 300), then dropped with a
  counter. The change-stream loop never blocks on audit IO.
- On shutdown, the bridge drains the audit queue with a
  `MONGO_CDC_AUDIT_DRAIN_TIMEOUT_SECONDS` (default 30) bound, then
  exits even if some entries are still pending.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: mongo-cdc audit-pipeline isolation from the
  change-stream loop and bounded-queue backpressure contract.

## Impact

- **Affected code**: `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`,
  `services/mongo-cdc-bridge/src/index.mjs`,
  `services/mongo-cdc-bridge/src/AuditWriter.mjs` (new),
  `services/mongo-cdc-bridge/src/MetricsCollector.mjs` (new counters).
- **Migration required**: none.
- **Breaking changes**: audit consumers that depend on synchronous
  ordering between the Kafka publish and the audit row in Postgres
  MUST tolerate a small (≤ 1s typical) lag; the existing migration's
  `mongo_capture_audit_log.observed_at` column preserves ordering at
  the row level.
- **Out of scope**: switching the audit pipeline to Kafka (rather than
  Postgres) — tracked separately under m2.
