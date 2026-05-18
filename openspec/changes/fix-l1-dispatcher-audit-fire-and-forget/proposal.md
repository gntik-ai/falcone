## Why

The operation dispatcher emits audits with `void emitAuditEvent(...)`
(fire-and-forget) and treats Kafka publish failures as informational —
the operation row is marked `completed` even when the corresponding
event never made it past the producer. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B11** (`operation-dispatcher.ts:63, :96-114, :145-159, :216-228,
  :246-260`) — `void emitAuditEvent(...)`; process crash between status
  transition and audit emission leaves operations completed without
  an audit row.
- **B12** (`operation-dispatcher.ts:211-237`) — operation marked
  `completed` first, then Kafka emission tried; if Kafka fails, the
  operation status diverges from the audit stream.
- **G19** (`G-S2.7`) — audit events from dispatcher are fire-and-forget
  (same as B11, raised).

## What Changes

- Await every `emitAuditEvent(...)` call in the dispatcher. If the
  audit write fails AND the audit-trail repository write succeeded,
  surface a structured warning but allow the status transition to
  complete (the fallback worker will republish).
- If the AUDIT-TRAIL DB write itself fails, the status transition MUST
  NOT be committed; roll back the operation update so the next sweep
  retries cleanly.
- Make the audit emission idempotent on `(operation_id, event_type,
  status)` so the fallback worker cannot double-publish.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on operation-status / audit-row
  atomicity and dispatcher audit awaitability.

## Impact

- **Affected code**:
  `services/backup-status/src/operations/operation-dispatcher.ts`,
  `services/backup-status/src/audit/audit-trail.ts`.
- **Migration required**: yes — add a uniqueness constraint
  `UNIQUE (operation_id, event_type)` on `backup_audit_events` to
  enforce idempotency at the DB level.
- **Breaking changes**: any pre-existing test that relied on
  fire-and-forget audit timing may need a small adjustment to await
  the audit promise.
- **Cross-cutting**: paired with `harden-l1-snapshot-and-audit-coverage`
  for the audit-trail repair work.
