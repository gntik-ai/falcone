## Why

The `pg-cdc-bridge` neither enforces capture quotas nor reports its operating
state back to the control plane, leaving operators flying blind. From
`openspec/audit/cap-d2-pg-cdc-bridge.md`:

- **G7** — migration `080-pg-capture-config.sql` creates `pg_capture_quotas`
  with `max_tables` per scope, but the bridge reads neither table. Quota
  enforcement lives only in `provisioning-orchestrator`'s control surface; the
  bridge will happily spawn listeners for any active config row regardless of
  quota state. A control-plane bug that allows over-provisioning silently
  succeeds at the bridge layer.
- **G8** — the bridge updates no row in `pg_capture_configs`. If a listener
  errors (G4, B3 in the audit) or the publisher cannot send (e.g., Kafka
  authn failure), the corresponding config row keeps `status = 'active'` and
  `last_error` is never set. Operators querying configs see no signal that
  capture is broken.

## What Changes

- On `WalListenerManager.start` and on every config-refresh tick, look up
  `pg_capture_quotas` for each `(tenant_id, workspace_id)` and refuse to spawn
  additional listeners once `current_table_count >= max_tables`. Refused configs
  get `status = 'errored'`, `last_error = 'quota_exhausted'`.
- On every listener error (including reconnect-loop exhaustion, slot creation
  failure, publication-membership reconciliation failure) write back to
  `pg_capture_configs.last_error` and transition `status` according to the
  rules: `Kafka transient → unchanged`, `replication-stream-dead → errored`,
  `slot-missing → errored`.
- On every successful publish-after-error transition (recovery), clear
  `last_error` and revert `status` to `active`.
- Emit a `pg_capture_audit_log` row for every status transition.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: pg-cdc bridge-side quota enforcement and
  status reporting back to `pg_capture_configs`.

## Impact

- **Affected code**: `services/pg-cdc-bridge/src/WalListenerManager.mjs`,
  `services/pg-cdc-bridge/src/PgWalListener.mjs`,
  `services/pg-cdc-bridge/src/StatusReporter.mjs` (new — wraps the
  `pg_capture_configs` and `pg_capture_audit_log` writes), and a new pool
  dedicated to the control-plane DB if not already shared.
- **Migration required**: none — the columns and tables already exist in
  `080-pg-capture-config.sql`.
- **Breaking changes**: operators who have monitoring built around
  `last_error IS NULL` AS healthy now see real failure data; alerting may
  need to widen its tolerance for transient errors before paging.
- **Out of scope**: pushing status to a streaming control-plane API (e.g., a
  websocket) — operators read `pg_capture_configs` directly today, which is
  sufficient.
