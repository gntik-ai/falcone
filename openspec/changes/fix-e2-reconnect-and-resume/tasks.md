## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/mongo-cdc-bridge/tests/unit/KafkaChangePublisher.rate-limit.test.mjs`
      sending 1500 events in one second from a single workspace; assert the
      publisher returns `{dropped: true, reason: 'rate-limited'}` for the
      500 over-limit events rather than throwing — fails today (throws).
- [ ] 1.2 [test] Add a watcher test asserting that after a rate-limited
      drop, the next publish's resume-token upsert reflects the dropped
      event's `_id`; restart MUST resume past the dropped event.
- [ ] 1.3 [test] Add a manager test where `watcher.start()` rejects
      synchronously; assert the watcher is removed from
      `this.watchers` AND the next cache cycle attempts a fresh spawn.
- [ ] 1.4 [test] Add a test asserting `manager.evictUnhealthy()` at the
      top of cache reload removes a watcher whose `lastEventAt` is older
      than `MONGO_CDC_EVICT_AFTER_SECONDS` and whose `healthy === false`.

## 2. Implementation

- [ ] 2.1 [fix] In `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:8`
      replace `throw new Error('MONGO_CDC_RATE_LIMITED')` with a return
      shape `{dropped: true, reason: 'rate-limited'}`; emit
      `'rate-limited'` on the EventEmitter and increment
      `mongo_cdc_events_rate_limited_total`.
- [ ] 2.2 [fix] In `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:54-55`
      handle the dropped-shape: skip the Kafka throw path, still call
      `resumeTokenStore.upsert(captureConfig.id, rawDoc._id)` so the
      stream advances past the dropped event.
- [ ] 2.3 [fix] In `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs:33`
      replace `.catch(() => {})` with `.catch(err => { this.watchers.delete
      (config.id); this._scheduleRetry(config, err); })`; log JSON and bump
      `mongo_cdc_watcher_start_failures_total`.
- [ ] 2.4 [fix] Add `manager.evictUnhealthy()` that walks
      `this.watchers` and calls `watcher.stop()` + `this.watchers.delete`
      for entries with `healthy === false` AND
      `Date.now() - lastEventAt > MONGO_CDC_EVICT_AFTER_SECONDS * 1000`;
      call it at the top of every cache reload cycle.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the rate-limit drop semantics and the watcher
      start-error retry contract in `services/mongo-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-e2-reconnect-and-resume --strict`; both green before merge.
