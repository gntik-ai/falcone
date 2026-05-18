## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add `services/pg-cdc-bridge/tests/unit/StatusReporter.quota.test.mjs`
      that creates `pg_capture_quotas (workspace_id, max_tables: 2)` and three
      `pg_capture_configs` rows for that workspace; assert only 2 listeners
      spawn and the third config has `status='errored'`,
      `last_error='quota_exhausted'`.
- [ ] 1.2 [test] Add a test that triggers a listener slot-creation failure
      (e.g., simulated permission error) and asserts the config row receives
      `last_error='slot-creation-failed: <details>'` and `status='errored'`
      within 2 seconds.
- [ ] 1.3 [test] Add a recovery test: after a listener has been `'errored'`,
      simulate the underlying error clearing and assert the next successful
      publish transitions `last_error → NULL` and `status → 'active'`, AND
      emits a `pg_capture_audit_log` row with `event_type='capture-recovered'`.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/pg-cdc-bridge/src/StatusReporter.mjs` exposing
      `markErrored(configId, reason)`, `markActive(configId)`, and
      `appendAudit(configId, eventType, payload)`; both write to
      `pg_capture_configs` and `pg_capture_audit_log` via the existing control
      pool.
- [ ] 2.2 [impl] In `WalListenerManager.start` and `_refreshConfigs`, before
      spawning a listener for a config, count active listeners per
      `(tenant_id, workspace_id)` and reject the spawn when `count >=
      max_tables`; call `StatusReporter.markErrored(config.id,
      'quota_exhausted')`.
- [ ] 2.3 [impl] In `PgWalListener`'s slot-creation and stream-open code
      paths, catch errors and route them through `StatusReporter.markErrored`
      with a typed reason (`slot-creation-failed`, `replication-start-failed`,
      `stream-dead`).
- [ ] 2.4 [impl] In `KafkaChangePublisher.publish`, after a successful send
      following any prior `markErrored`, call `StatusReporter.markActive` and
      `appendAudit('capture-recovered', {…})`. Track the per-config error
      state in memory to avoid hammering the control DB on every success.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the status-reporting contract and the set of
      typed `last_error` reasons in `services/pg-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-d2-status-reporting --strict`; both green before merge.
