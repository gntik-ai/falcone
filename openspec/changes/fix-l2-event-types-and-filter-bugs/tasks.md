## 1. Failing tests

- [ ] 1.1 [test] Add `apps/console/src/components/backup/AuditEventFilters.test.tsx`
      asserting `EVENT_TYPES` includes every canonical backup/restore
      identifier (including `restore.confirmation_*` and `restore.simulation.*`),
      proving B2 from `AuditEventFilters.tsx:9-12`. Add a case that selecting
      `eventType=backup.completed` disables `result=failed`, proving B11.
- [ ] 1.2 [test] Add a case asserting `backup-audit.api.ts` throws at module
      load when `VITE_API_BASE_URL` is unset, proving B10 from `:7`.
- [ ] 1.3 [test] Add a case asserting `<AuditEventTable>` derives `colSpan`
      from the column array length, proving G7 from `AuditEventTable.tsx:54`.

## 2. Implementation

- [ ] 2.1 [impl] Extract `EVENT_TYPES` into
      `apps/console/src/lib/constants/audit-event-types.ts` sourced from the
      L1 canonical list; import it in `AuditEventFilters.tsx:9-12`.
- [ ] 2.2 [fix] Render the converted UTC ISO string beneath the
      `datetime-local` inputs in `AuditEventFilters.tsx:78, :84` and add a
      `(UTC)` suffix to the field label so B6's silent shift becomes visible.
- [ ] 2.3 [fix] Replace the `''` fallback at `backup-audit.api.ts:7` with a
      `throw new Error('VITE_API_BASE_URL is required')`; document the env
      var in the README.
- [ ] 2.4 [fix] Compute disabled `result` options in
      `AuditEventFilters.tsx:63-74` from the selected `eventType` suffix and
      grey out incompatible values.
- [ ] 2.5 [fix] Declare a `COLUMNS = [...]` array in `AuditEventTable.tsx`
      and replace `colSpan={role === 'admin' ? 7 : 5}` at `:54` with
      `COLUMNS.filter(...).length`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/console test` and
      `openspec validate fix-l2-event-types-and-filter-bugs --strict`; both
      green before merge.
