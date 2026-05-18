## Why

The operations repository's "is there an active operation already?"
check is a TOCTOU race, and the snapshot-validation logic on the
trigger-restore path is duplicated and drifts between sites. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B5** (`operations/operations.repository.ts:100-118`) — `findActive`
  is `SELECT ... WHERE ... AND status IN ('accepted', 'in_progress')
  LIMIT 1` with no `FOR UPDATE` or advisory lock. Two concurrent
  triggers for the same `(tenant, component, instance, type)` both see
  no active and both insert.
- **B17** (`trigger-restore.action.ts:54-69`) — snapshot validation is
  duplicated and inconsistent versus the inline copy at
  `trigger-restore.action.ts:131-150`; the two diverge on accepted
  shapes.
- **G15** (`G-S2.3`) — snapshot validation duplicated (same as B17,
  raised).

## What Changes

- Replace `findActive` + `create` with a single upsert-style insert
  guarded by a partial unique index
  `(tenant_id, component_type, instance_id, type) WHERE status IN
  ('accepted','in_progress')`; on conflict, return the existing row.
- Alternatively, wrap `findActive` + `create` in an advisory-lock
  transaction (`pg_advisory_xact_lock(hashtext(...))`); the migration
  below offers the index approach as the primary.
- Extract the snapshot-validation logic into a single
  `validateSnapshotForRestore(snapshot, body)` helper used by both
  sites in `trigger-restore.action.ts`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on concurrent-trigger
  serialisation and snapshot-validation source-of-truth.

## Impact

- **Affected code**:
  `services/backup-status/src/operations/operations.repository.ts`,
  `services/backup-status/src/api/trigger-restore.action.ts`,
  `services/backup-status/src/api/trigger-backup.action.ts` (cite
  site), `services/backup-status/migrations/005_unique_active.sql`
  (new).
- **Migration required**: yes — additive partial unique index on
  `backup_operations`.
- **Breaking changes**: a second concurrent trigger will now receive
  a structured `OPERATION_ALREADY_ACTIVE` response (with the existing
  operation id) instead of accidentally creating a duplicate row.
- **Cross-cutting**: cleanup work in `harden-l1-snapshot-and-audit-coverage`
  may further harden snapshot-validation against drift; the helper
  extracted here is the foundation.
