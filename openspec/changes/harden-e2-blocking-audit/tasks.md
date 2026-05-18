## 1. Failing tests proving the gap

- [ ] 1.1 [test] Add `services/mongo-cdc-bridge/tests/unit/AuditWriter.backpressure.test.mjs`
      that swaps in a Postgres pool whose `query` takes 5 seconds, enqueues
      100 audit entries, and asserts the change-stream loop's
      `processNextDocument` returns in under 100 ms — fails today
      (synchronous await).
- [ ] 1.2 [test] Add a test asserting that when the queue exceeds
      `MONGO_CDC_AUDIT_QUEUE_MAX`, the oldest entry is dropped and
      `mongo_cdc_audit_dropped_total` increments.
- [ ] 1.3 [test] Add a shutdown test asserting the bridge drains the
      audit queue within `MONGO_CDC_AUDIT_DRAIN_TIMEOUT_SECONDS` and
      exits 0 even if some entries remain pending after the timeout.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/mongo-cdc-bridge/src/AuditWriter.mjs`
      exposing `enqueue(entry)`, `start()`, `drain(timeoutMs)`, and a
      private worker loop that pulls from a bounded `Array` queue and
      runs the original Postgres insert with exponential backoff up to
      `MONGO_CDC_AUDIT_RETRY_MAX_SECONDS`.
- [ ] 2.2 [fix] Replace the two synchronous `await this.auditCallback(...)`
      sites at `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:52`
      and `:62` with `this.auditEmitter.enqueue({eventType, captureConfig,
      data})`.
- [ ] 2.3 [fix] In `services/mongo-cdc-bridge/src/index.mjs:29`
      construct an `AuditWriter(pool, …)` and pass `enqueue` as the
      callback; call `auditWriter.start()` in the bootstrap sequence
      and `auditWriter.drain(MONGO_CDC_AUDIT_DRAIN_TIMEOUT_SECONDS *
      1000)` in the SIGTERM handler before `pool.end()`.
- [ ] 2.4 [impl] Add metrics `mongo_cdc_audit_queue_size{}`,
      `mongo_cdc_audit_dropped_total{}`,
      `mongo_cdc_audit_retries_total{}` to `MetricsCollector` and emit
      from `AuditWriter`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the audit-pipeline asynchrony, queue bounds,
      and shutdown semantics in `services/mongo-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-e2-blocking-audit --strict`; both green before merge.
