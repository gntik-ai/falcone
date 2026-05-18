## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/mongo-cdc-bridge/tests/unit/MongoCaptureConfigCache.modified.test.mjs`
      that toggles `capture_mode` from `delta` to `full-document` on an
      existing row and asserts `'modified'` is emitted with the new row
      — fails today.
- [ ] 1.2 [test] Add a manager test asserting that on `'modified'` the
      old `ChangeStreamWatcher` is stopped, removed from the map, and a
      fresh watcher is started with the new config.
- [ ] 1.3 [test] Add a `'reactivated'` test where a row goes
      `active → removed (errored) → active` between two polls; assert
      that on the next reload, `'reactivated'` fires and the manager
      spawns a new watcher.

## 2. Implementation

- [ ] 2.1 [fix] In `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs:18-25`
      compute `hashRow(row) = sha1(JSON.stringify({data_source_ref,
      database_name, collection_name, capture_mode, status}))`. For each
      existing id, compare hashes between the prior cached row and the
      new row; emit `'modified'` with the new row when they differ.
- [ ] 2.2 [fix] Track `_lastSeenAt[id]` in the cache; when an id
      reappears after having been absent and
      `Date.now() - _lastSeenAt[id] < MONGO_CDC_REACTIVATION_WINDOW_SECONDS
      * 1000`, emit `'reactivated'` instead of `'added'`.
- [ ] 2.3 [fix] In `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs`
      subscribe to `'modified'` and `'reactivated'`; on either, call
      `oldWatcher?.stop()`, `this.watchers.delete(config.id)`, then
      `this._startWatcher(newConfig)`.
- [ ] 2.4 [fix] Augment the cache reload SELECT to include
      `updated_at`; include `updated_at` in the hash input so any
      control-plane-recorded mutation is detected even when watch-relevant
      fields are unchanged.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the cache events (`added`, `modified`,
      `removed`, `reactivated`) and the manager's response in
      `services/mongo-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-e2-config-cache-sync --strict`; both green before merge.
