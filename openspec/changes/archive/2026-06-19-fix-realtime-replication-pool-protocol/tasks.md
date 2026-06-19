# Tasks — fix-realtime-replication-pool-protocol

## Reproduce (test-first)
- [x] Added a failing black-box test (`tests/blackbox/realtime-replication-pool-protocol.test.mjs`,
  bbx-626-01..05) that constructs `createRealtimeExecutor` with an engine `connectionString` containing
  `replication=database` and asserts the provisioning pool is built from a sanitized (non-replication)
  config — failing while the executor passed the raw config straight to `new pg.Pool(...)`.

## Implement
- [x] `apps/control-plane/src/runtime/realtime-executor.mjs`: added `nonReplicationConfig(config)` (strips
  the `replication` key + the `replication` query param from `connectionString`) + a `poolFactory` seam;
  the provisioning pool is built from the sanitized config. Replication client unchanged (it forces
  `replication: 'database'`).
- [x] `tests/live-campaign/make-secrets.sh`: dropped `&replication=database` from the `realtime-url` literal.
- [x] `apps/control-plane/src/runtime/server.mjs`: include the underlying error message in both realtime
  SSE `event: error` frames (pre-stream catch + streaming `onError`).

## Verify
- [x] New black-box test passes (5/5); `bash tests/blackbox/run.sh` green (948/948); unit/contracts/adapters
  green (no regressions).
- [ ] Acceptance: a subscription against a `replication=database` engine URL establishes without `08P01`;
  an inserted document is delivered as an `event: insert` frame (real-stack verification on kind).

## Archive
- [ ] `openspec validate fix-realtime-replication-pool-protocol --strict`; archive after merge.
