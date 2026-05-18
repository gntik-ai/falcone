## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/operations/operation-dispatcher.test.ts`
      where `emitAuditEvent` rejects after the operation row update;
      assert the dispatcher does NOT return as if successful and that
      a structured warning is logged.
- [ ] 1.2 [test] Add a case where the audit-trail DB INSERT fails
      (Kafka unset); assert the operation row update is rolled back —
      the operation status MUST NOT transition to `completed` without
      an audit row.
- [ ] 1.3 [test] Add a case where the fallback worker republishes an
      already-persisted audit row; assert the DB-level uniqueness
      constraint on `(operation_id, event_type)` prevents a duplicate
      insert.

## 2. Implementation

- [ ] 2.1 [fix] Replace every `void emitAuditEvent(...)` in
      `operation-dispatcher.ts:63, :96-114, :145-159, :216-228,
      :246-260` with `await emitAuditEvent(...)`; wrap in a try/catch
      that re-throws when the AUDIT-TRAIL DB write itself fails.
- [ ] 2.2 [fix] In `operation-dispatcher.ts:211-237`, perform the
      audit-trail DB write inside the same transaction as the
      operation-row status transition; commit only when both succeed.
- [ ] 2.3 [migration] Add migration
      `005_audit_events_unique_operation_event.sql` adding
      `UNIQUE (operation_id, event_type)` on `backup_audit_events`.
- [ ] 2.4 [fix] In `audit/audit-trail.ts:21-33`, on UNIQUE-violation
      from the new constraint, treat the insert as success (idempotent
      replay).

## 3. Validation

- [ ] 3.1 [test] Re-run dispatcher + audit-trail test suites and
      `openspec validate fix-l1-dispatcher-audit-fire-and-forget --strict`;
      all green.
- [ ] 3.2 [docs] Document the transactional audit + uniqueness
      constraint in `services/backup-status/README.md` (audit section).
