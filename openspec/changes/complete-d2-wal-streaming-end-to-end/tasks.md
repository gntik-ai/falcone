## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/pg-cdc-bridge/tests/integration/wal-streaming.integration.test.mjs`
      that inserts a row into a watched table and asserts a corresponding Kafka
      event is published within 5s — this MUST fail today (no streaming wired).
- [ ] 1.2 [test] Add a unit test asserting `PgWalListener.start()` issues
      `START_REPLICATION SLOT … LOGICAL` and registers a `copyData` listener,
      not just `CREATE_REPLICATION_SLOT`.
- [ ] 1.3 [test] Add a test that enables a new `pg_capture_configs` row after
      `WalListenerManager.start()` has returned and asserts a listener spawns
      within `PG_CDC_CONFIG_REFRESH_SECONDS` without a process restart.
- [ ] 1.4 [test] Add a test that asserts a publication is created on enable
      and that the captured table appears in `pg_publication_tables`.

## 2. Implementation

- [ ] 2.1 [migration] Add `082-pg-capture-publication.sql` introducing
      `pg_capture_configs.publication_name` and `pg_capture_publications`
      (`data_source_ref` PK, deterministic `baas_cdc_<sha1[:8]>` name).
- [ ] 2.2 [impl] Add `services/pg-cdc-bridge/src/PublicationManager.mjs` that
      issues `CREATE PUBLICATION` if absent and reconciles `ALTER PUBLICATION …
      ADD/DROP TABLE` to match `pg_capture_configs` rows for the ref.
- [ ] 2.3 [impl] Rewrite `PgWalListener.start()` to issue `START_REPLICATION SLOT
      <slot> LOGICAL <lsn> ("proto_version" '1', "publication_names" '<pub>')`,
      attach a `copyData` handler that calls `processMessage(buffer, lsn,
      committedAt)`, and emit `Standby Status Update` every
      `PG_CDC_STATUS_INTERVAL_SECONDS ?? 10`.
- [ ] 2.4 [impl] Persist `lastAckedLsn` to `pg_capture_configs.lsn_acked` on
      every successful Kafka publish so a restart resumes from the committed
      offset rather than slot tail.
- [ ] 2.5 [impl] Add a periodic `WalListenerManager._refreshConfigs()` running
      every `PG_CDC_CONFIG_REFRESH_SECONDS ?? 30`, invalidating the cache,
      spawning listeners for new refs, stopping listeners for removed refs,
      and updating publication membership via `PublicationManager`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the WAL streaming architecture, publication lifecycle,
      and slot recycling contract in `services/pg-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      complete-d2-wal-streaming-end-to-end --strict`; both green before merge.
