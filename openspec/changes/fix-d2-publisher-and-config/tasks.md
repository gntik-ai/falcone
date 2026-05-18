## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/pg-cdc-bridge/tests/unit/KafkaChangePublisher.topic.test.mjs`
      that sets `PG_CDC_KAFKA_TOPIC_PREFIX="foo"` and publishes events for two
      different `(tenant, workspace)` pairs; assert the two events land on
      `foo.<tenant1>.<workspace1>.pg-changes` and `foo.<tenant2>.…` respectively
      — fails today (both land on `foo`).
- [ ] 1.2 [test] Add a case asserting that when `publish` is rate-limited, the
      `WalListenerManager` writes `pg_capture_configs.last_error` and inserts
      a `pg_capture_audit_log` row with `event_type='capture-rate-limited'`.
- [ ] 1.3 [test] Add a `CaptureConfigCache` test where the underlying query
      rejects; assert `RouteFilter.match` returns `[]` for that ref and does
      NOT use the previous-cycle cached rows.
- [ ] 1.4 [test] Add a leak test: simulate 10 000 distinct workspaces emitting
      one event each, wait `PG_CDC_WINDOW_TTL_SECONDS`, assert
      `publisher.windows.size` shrinks below 100.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `KafkaChangePublisher.mjs:10` topic resolution to
      `prefix = process.env.PG_CDC_KAFKA_TOPIC_PREFIX`,
      `override = process.env.PG_CDC_KAFKA_TOPIC_OVERRIDE`,
      `topic = override ?? (prefix ? \`${prefix}.${tenant}.${workspace}.pg-changes\`
      : \`${tenant}.${workspace}.pg-changes\`)`. Warn at boot when `_OVERRIDE`
      is set.
- [ ] 2.2 [fix] Subscribe `WalListenerManager` to the publisher's `'rate-limited'`
      event; on receipt, `UPDATE pg_capture_configs SET last_error =
      'rate-limited' WHERE id = $1` for every config matching the workspace and
      `INSERT INTO pg_capture_audit_log (event_type, capture_config_id, …)
      VALUES ('capture-rate-limited', …)`.
- [ ] 2.3 [fix] Change `CaptureConfigCache.mjs:11-14` to set `this._cache[ref]
      = {rows: [], stale: true, error}` on query failure; expose `isStale(ref)`
      and have `RouteFilter.match` short-circuit to `[]` when stale.
- [ ] 2.4 [fix] Add `PG_CDC_WINDOW_TTL_SECONDS` (default 600) and a periodic
      sweep in `KafkaChangePublisher` that deletes `windows` entries whose
      latest timestamp is older than the TTL; also delete on workspace
      `'removed'` events from the cache.
- [ ] 2.5 [migration] Update `helm/pg-cdc-bridge/values.yaml` to surface the
      two env vars separately and document the migration path from the old
      single-value `_PREFIX` semantics.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the new topic-naming contract and the `_OVERRIDE`
      kill-switch semantics in `services/pg-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-d2-publisher-and-config --strict`; both green before merge.
