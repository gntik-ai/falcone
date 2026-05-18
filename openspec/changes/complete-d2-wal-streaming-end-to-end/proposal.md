## Why

The `services/pg-cdc-bridge/` service does not actually stream WAL. It creates a
replication slot, sets `_running = true`, and idles — zero Kafka events flow
end-to-end. From `openspec/audit/cap-d2-pg-cdc-bridge.md`:

- **B1** (`services/pg-cdc-bridge/src/PgWalListener.mjs:8-13`) — `start()` opens a
  replication-mode `pg.Client`, runs `CREATE_REPLICATION_SLOT`, flips
  `_running = true`, and returns. No `START_REPLICATION SLOT … LOGICAL pgoutput`
  is ever issued; no `copyData` handler is attached; `package.json` declares no
  `pg-logical-replication` dependency. The bridge holds open one replication slot
  per `data_source_ref` and emits nothing.
- **B9** (`services/pg-cdc-bridge/src/WalListenerManager.mjs:20-23`) — `start()`
  runs `SELECT DISTINCT data_source_ref FROM pg_capture_configs WHERE status =
  'active'` once at boot and never re-reads. `CaptureConfigCache.invalidate`
  (`CaptureConfigCache.mjs:16`) exists but is never called. New capture configs
  require a process restart.
- **G1** — `grep -l "START_REPLICATION\|copyData\|pg-logical-replication"
  services/pg-cdc-bridge/` returns nothing. End-to-end Postgres→Kafka is unwired.
- **G2** — `PgWalListener.processMessage` (`PgWalListener.mjs:14-21`) is exported
  as if it were a stream callback but no caller in the package invokes it.
- **G6** — `pgoutput` decoding requires a Postgres `PUBLICATION` covering the
  captured tables. There is no `CREATE PUBLICATION` step anywhere in the bridge
  or the orchestrator's enable action.

## What Changes

- Wire `START_REPLICATION SLOT <name> LOGICAL <publication> ("proto_version" '1',
  "publication_names" '<pub>')` from `PgWalListener.start()` and attach a
  `copyData` handler that feeds `processMessage`.
- Manage one logical publication per `data_source_ref` (`baas_cdc_<sha1[:8]>`),
  reconciling membership to `pg_capture_configs` rows tagged for that ref via
  `ALTER PUBLICATION … ADD/DROP TABLE`.
- Persist `lastAckedLsn` per slot to `pg_capture_configs` and reply with
  `Standby Status Update` (CopyData `r`) every `PG_CDC_STATUS_INTERVAL_SECONDS`
  so Postgres can recycle WAL.
- Periodically reload `pg_capture_configs` (every `PG_CDC_CONFIG_REFRESH_SECONDS`)
  and call `CaptureConfigCache.invalidate(ref)` so new/removed rows take effect
  without a restart; spawn/stop listeners and publication-membership updates to
  match.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: WAL streaming end-to-end requirement, publication
  lifecycle, replication-slot status reporting, runtime config refresh.

## Impact

- **Affected code**: `services/pg-cdc-bridge/src/PgWalListener.mjs`,
  `services/pg-cdc-bridge/src/WalListenerManager.mjs`,
  `services/pg-cdc-bridge/src/CaptureConfigCache.mjs`,
  `services/pg-cdc-bridge/src/PublicationManager.mjs` (new),
  `services/pg-cdc-bridge/package.json` (add `pg-logical-replication` or hand-rolled
  copyData loop), `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs`
  (create publication on enable), and migration `082-pg-capture-publication.sql`
  recording the per-ref publication name.
- **Migration required**: new column `pg_capture_configs.publication_name` and
  table `pg_capture_publications(data_source_ref PK, publication_name UNIQUE,
  created_at)`; existing active configs backfilled with a deterministic
  publication name and the publication created in Postgres at deploy.
- **Breaking changes**: bridges previously reporting healthy with zero events
  will start failing readiness on `START_REPLICATION` errors — this is the
  intended behaviour and surfaces real failures that were hidden.
- **Out of scope**: cross-region failover of replication slots; switchover to
  Debezium (option 2 in the audit scope note) — covered separately if chosen.
