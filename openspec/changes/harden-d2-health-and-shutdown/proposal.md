## Why

The `pg-cdc-bridge` lies about its liveness and shuts down without draining
in-flight work. From `openspec/audit/cap-d2-pg-cdc-bridge.md`:

- **B2** (`services/pg-cdc-bridge/src/HealthServer.mjs:7`) — `/health` returns
  200 if every listener has `isRunning === true` and the publisher is
  `connected`. `isRunning` is set true at `PgWalListener.mjs:12` immediately
  after slot creation and is never reset by stream death (since today no stream
  exists). Combined with B1, both readiness and liveness probes pass for a
  permanently comatose bridge — Kubernetes will never restart it.
- **B3** (`services/pg-cdc-bridge/src/index.mjs:14-16`) —
  `await manager.start()` runs at top level with no `.catch`. If
  `WalListenerManager.start` rejects (DB unavailable, slot creation fails for
  reasons other than `42710`), the Node process exits unhandled.
- **B15** (`services/pg-cdc-bridge/src/index.mjs:17`) — on `SIGTERM`,
  `manager.stop()` ends each listener's `pg.Client` in parallel then
  `publisher.disconnect()` flushes Kafka. In-flight `publish()` promises from
  listener message handlers race against the shutdown. Suppressed today by B1
  but lethal once streaming is wired.
- **G3** (`HealthServer.mjs:7`) — health checks lie about liveness, see above.
- **G22** (`index.mjs:17`) — no graceful drain; Kafka in-flight messages have
  no awaited drain handle beyond `disconnect()`.

## What Changes

- Add a `lastEventAt`/`lastAckedLsn` heartbeat per listener; `/health` MUST
  return 503 if any listener has been silent for more than
  `PG_CDC_HEALTH_STALE_SECONDS` (default 60) when the publication has tables
  with recent commit activity (best-effort via a periodic Postgres probe
  reading `pg_stat_replication`).
- Distinguish `/healthz` (liveness — process is alive) from `/readyz` (readiness
  — slots are open AND consuming OR known-idle). Helm chart wired to the new
  endpoints.
- Wrap `manager.start()` in a top-level `.catch` that logs JSON, attempts
  `manager.stop()` for cleanup, then `process.exit(1)`.
- Rewrite the shutdown sequence to (a) signal each listener to stop consuming
  new copyData (drain mode), (b) `await Promise.all(inFlightPublishes)`, (c)
  `publisher.disconnect()` (Kafka flush), (d) `client.end()` per listener,
  (e) `pool.end()`. Each step honours `PG_CDC_SHUTDOWN_TIMEOUT_SECONDS`
  (default 30) before forced exit.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: pg-cdc liveness/readiness semantics, top-level
  error handling, graceful drain on SIGTERM.

## Impact

- **Affected code**: `services/pg-cdc-bridge/src/HealthServer.mjs`,
  `services/pg-cdc-bridge/src/PgWalListener.mjs`,
  `services/pg-cdc-bridge/src/WalListenerManager.mjs`,
  `services/pg-cdc-bridge/src/index.mjs`,
  `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/deployment.yaml` (probes
  remapped to `/healthz` and `/readyz`).
- **Migration required**: none in DB schema; Helm chart values change requires
  redeploy.
- **Breaking changes**: deployments relying on the single `/health` endpoint
  for both probes MUST update to the split endpoints (the old `/health` stays
  as an alias for `/readyz` for one release).
- **Out of scope**: distributed leader election for multi-replica deployments —
  the bridge is single-writer per slot and the deployment uses
  `replicas: 1`.
