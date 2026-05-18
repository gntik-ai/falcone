## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add `services/mongo-cdc-bridge/tests/unit/ChangeStreamWatcher.oversize.test.mjs`
      with a stub `OversizeSpillStore` and a doc whose serialised envelope
      exceeds the limit; assert the spill is written, the Kafka payload
      contains the pointer, and the resume token advances — fails today
      (silent strip).
- [ ] 1.2 [test] Add a manager test that spawns two watchers sharing a
      ref, stops one, asserts the Mongo client is still open; stops the
      second, asserts `client.close()` was called exactly once.
- [ ] 1.3 [test] Add a leak test for `KafkaChangePublisher.windows`:
      10 000 workspaces each emit one event, wait
      `MONGO_CDC_WINDOW_TTL_SECONDS`, assert `windows.size` drops below
      100.
- [ ] 1.4 [test] Add a first-run capture test: a config with
      `activation_ts = T-300s` is started at T+0 with no resume token;
      assert `startAtOperationTime` equals the BSON Timestamp for
      `activation_ts`, not `new Date()`.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/mongo-cdc-bridge/src/OversizeSpillStore.mjs`
      that uploads `{key: <capture>/<doc-key>.json, body: <json>}` to the
      configured object-storage bucket (S3-compatible); fall back with
      WARN log when not configured.
- [ ] 2.2 [fix] Replace the stripped-envelope branch at
      `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:48-53` with
      `await spillStore.put(captureConfig.id, rawDoc)` then publish a
      `{__spilled: true, uri}` payload; increment
      `mongo_cdc_oversized_spilled_total`.
- [ ] 2.3 [fix] In `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs:16-19`
      keep `_mongoClients` as `Map<ref, {client, refcount}>`; increment
      on `_startWatcher`, decrement on `watcher.stop()`, close when
      refcount hits 0.
- [ ] 2.4 [fix] Add `MONGO_CDC_WINDOW_TTL_SECONDS` and a periodic sweep
      in `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs` that
      evicts `windows` entries idle beyond the TTL.
- [ ] 2.5 [fix] In `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:40`
      when `storedResumeToken` is absent, set `startAtOperationTime` to
      `Timestamp.fromDate(captureConfig.activation_ts ?? new Date())`
      rather than `new Date()`; comment the contract.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the oversize spill contract, the client
      lifecycle, and the activation-replay behaviour in
      `services/mongo-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-e2-oversized-and-leaks --strict`; both green before merge.
