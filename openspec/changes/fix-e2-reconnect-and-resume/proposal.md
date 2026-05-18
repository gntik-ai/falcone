## Why

The `mongo-cdc-bridge` rate-limit path destroys watcher progress under load
and a dead watcher is silently retained when start rejects. From
`openspec/audit/cap-e2-mongo-cdc-bridge.md`:

- **B1** (`services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:8` +
  `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:54-55`) —
  `KafkaChangePublisher.publish` **throws** `Error('MONGO_CDC_RATE_LIMITED')`
  when a workspace exceeds 1000 events/s. The throw bubbles out of the
  `for await` loop, the outer catch treats it as a transient stream error,
  sleeps with exponential backoff, and reopens the stream from the **same
  resume token** (because the upsert at `:55` runs AFTER the throwing
  publish at `:54`). Every retry rate-limits again; the watcher walks the
  reconnect ladder to `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` (default 10) and
  is permanently marked `errored`. A workspace that crosses the threshold
  for a few minutes loses capture entirely.
- **B5** (`services/mongo-cdc-bridge/src/ChangeStreamManager.mjs:33`) —
  `watcher.start().catch(() => {})` discards any synchronous start
  error. The watcher was already registered at `:32`. If `start()` rejects
  (e.g., `mongoClient.db().collection().watch()` throws on an invalid db
  name), the watcher stays in `this.watchers` with default `healthy = true`;
  `/health` reports OK; the duplicate-add guard at `:22` refuses to
  recreate it.
- **B10** (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:54-55`) —
  resume-token upsert and Kafka publish are not atomic. A crash between
  the two re-publishes the event on restart. Acceptable as at-least-once
  but the ordering also enables B1.
- **G3** — the dead-watcher window: after a watcher exhausts max-reconnect
  and writes `status='errored'`, the cache reload (which filters
  `status='active'`) drops it on the next poll, but the watcher remains
  in the map up to `ttlSeconds` (default 30) reporting `healthy: false`.

## What Changes

- Rewrite the publisher: instead of throwing on rate-limit, **drop the
  event with a counter and emit a `'rate-limited'` event** (matching D2's
  semantics after `fix-d2-publisher-and-config`). The watcher's resume
  token MUST advance past the dropped event.
- Wrap `watcher.start()` in `ChangeStreamManager` so synchronous rejection
  removes the watcher from the map AND surfaces a typed error to the
  caller; the manager retries via the next cache cycle.
- Reorder the watcher loop so the resume token is upserted in the same
  try-block as the publish, with a rollback path that re-throws and lets
  the outer reconnect logic proceed correctly when the publish (not the
  rate-limit) actually fails.
- Add a `manager.evictUnhealthy()` call at the top of each cache reload
  cycle so a dead watcher cannot linger between status flip and next
  poll.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: mongo-cdc rate-limit semantics, watcher
  start-error handling, resume-token atomicity contract, and dead-watcher
  eviction.

## Impact

- **Affected code**: `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs`,
  `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`,
  `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs`.
- **Migration required**: none.
- **Breaking changes**: workspaces that previously self-destructed on
  rate-limit will now drop events (matching D2 behaviour) and stay
  online; operators relying on `last_error = 'max-reconnect-exceeded'`
  to detect overload MUST switch to the new metric.
- **Out of scope**: dead-letter spilling of rate-limited events
  (deferred — counter + audit are sufficient signal).
