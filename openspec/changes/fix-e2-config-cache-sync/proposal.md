## Why

The `mongo-cdc-bridge` config cache emits `added`/`removed` events but no
`modified` event, so in-place config mutations silently de-sync the
running watcher from the row in the control plane. From
`openspec/audit/cap-e2-mongo-cdc-bridge.md`:

- **B4** (`services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs:21-22`)
  — the reload diff only checks `id` presence. A change to `capture_mode`,
  `database_name`, `collection_name`, or `data_source_ref` on an existing
  id silently replaces the cached row, but the running
  `ChangeStreamWatcher` still uses the `captureConfig` captured at
  construction time (`ChangeStreamWatcher.mjs:7`). A
  `capture_mode` toggle from `delta` to `full-document` requires a
  process restart.
- **G1** — `MongoCaptureConfigCache` does not emit `modified` events;
  same root cause as B4, listed separately as a gap.
- **G4** — the `added` event won't re-fire on `active → paused → active`
  cycles that complete inside one poll window; the cache misses the
  intermediate state.
- **G17** — `_startWatcher`'s duplicate-add guard at
  `ChangeStreamManager.mjs:22` (`if (this.watchers.has(config.id))
  return;`) means even if the cache did emit `'added'` for a mutated
  config, the manager would silently skip recreating the watcher.

## What Changes

- Hash each cached row (deterministic stable hash over watch-relevant
  fields: `data_source_ref, database_name, collection_name, capture_mode,
  status`) and emit `'modified'` when the hash for an existing id
  changes between reloads.
- On `'modified'`, the manager MUST stop the old watcher, delete it
  from the map, and start a fresh one carrying the updated config.
- Persist a `last_seen_at` per id and emit `'reactivated'` when an id
  reappears after having been removed at any point in the last
  `MONGO_CDC_REACTIVATION_WINDOW_SECONDS` (default 300); the manager
  treats `'reactivated'` like `'added'`.
- Track and re-emit transitions even when they fit inside one poll
  window by reading the row's `updated_at` and emitting on change.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: mongo-cdc config-cache change-detection
  contract, in-place mutation reconciliation, and manager response to
  `modified`/`reactivated` events.

## Impact

- **Affected code**: `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs`,
  `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs`.
- **Migration required**: none — uses existing `updated_at` column.
- **Breaking changes**: operators that toggled config fields and then
  restarted the bridge as the only reconciliation path can now drop the
  restart step.
- **Out of scope**: full transactional row-versioning (an `op_log` for
  `mongo_capture_configs`) — the hash + `updated_at` combination is
  sufficient.
