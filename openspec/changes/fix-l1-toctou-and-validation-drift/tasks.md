## 1. Failing tests

- [ ] 1.1 [test] Add a concurrency test to
      `services/backup-status/src/operations/operations.repository.test.ts`
      that fires two concurrent trigger requests for the same
      `(tenant, component, instance, type)`; assert exactly one
      operation row is created and the second caller observes
      `OPERATION_ALREADY_ACTIVE`.
- [ ] 1.2 [test] Add a case to
      `services/backup-status/src/api/trigger-restore.action.test.ts`
      asserting both the request-body-validation site (`:54-69`) and
      the inline site (`:131-150` per audit) reject identically for the
      same malformed snapshot reference.

## 2. Implementation

- [ ] 2.1 [migration] Add migration
      `005_unique_active_backup_operations.sql` creating
      `CREATE UNIQUE INDEX CONCURRENTLY backup_operations_active_uq
      ON backup_operations (tenant_id, component_type, instance_id, type)
      WHERE status IN ('accepted','in_progress')`.
- [ ] 2.2 [fix] Rewrite `operations.repository.ts:100-118`:
      replace `findActive` + separate `create` with an INSERT … ON
      CONFLICT DO NOTHING RETURNING; on no-return, SELECT the existing
      row and return it as `{ existed: true, row }`.
- [ ] 2.3 [fix] Update callers in
      `trigger-backup.action.ts:116-120` and
      `trigger-restore.action.ts:102-104, :212-215` to handle the
      `existed: true` branch with a `409 OPERATION_ALREADY_ACTIVE`
      response carrying the existing operation id.
- [ ] 2.4 [fix] Extract snapshot validation from
      `trigger-restore.action.ts:54-69` and `:131-150` into a
      `validateSnapshotForRestore(snapshot, body)` helper under
      `services/backup-status/src/operations/snapshot-validation.ts`;
      call it from both sites.

## 3. Validation

- [ ] 3.1 [test] Re-run L1 unit + concurrency tests and `openspec
      validate fix-l1-toctou-and-validation-drift --strict`; all green.
- [ ] 3.2 [docs] Document the new uniqueness constraint and the
      `OPERATION_ALREADY_ACTIVE` response in
      `services/backup-status/README.md`.
