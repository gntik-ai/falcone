## Reconciliation notes

**Harness**: This is a TypeScript service; the reproduction tests live in the existing vitest suite
`services/backup-status/test/unit/operations/get-operation.action.test.ts`, NOT in
`tests/blackbox/run.sh` (node --test, cannot load .ts). Run reproduction with
`cd services/backup-status && npx vitest run`. Run `bash tests/blackbox/run.sh` at repo
root for regression only.

**Optional tenantId on findById**: `operation-dispatcher.{ts,js}::dispatch` calls
`repo.findById(operationId)` with no tenant context (it discovers the operation before
knowing the tenant). Therefore `tenantId` is an OPTIONAL second parameter; the SQL clause
`AND tenant_id = $2` is only appended when `tenantId != null`. The dispatcher required NO
change — confirmed by `test/unit/operations/operation-dispatcher.test.ts` passing without
modification.

**Pre-existing test updates**: `tenantId: 'tenant-a'` was added to token mocks in:
- `test/unit/operations/get-operation.action.test.ts` (CA-12 technical, CA-12 owner, 404,
  403, adapterOperationId tests) — intent preserved; the fix now requires the token
  tenant to match the operation tenant for the happy path.
- `test/contract/backup-operations-response.contract.test.ts` (does not contain
  failure_reason contract test) — same reason; intent preserved.

**Other findById callers**: only `operation-dispatcher` calls the OPERATIONS `findById`.
It uses the no-tenantId path intentionally. No other caller requires a change. The
`confirmations.repository.ts::findById` is a different module and was NOT touched.

## 1. Failing black-box test

- [x] 1.1 Add IDOR cross-tenant probe test in `get-operation.action.test.ts`:
  token `{sub:'user-x', tenantId:'tenant-b', ...}`; assert `findById` called with
  `('op-1','tenant-b')` and result is 404 (not 403). RED before fix.
- [x] 1.2 Add backup:read:global cross-tenant test: token from tenant-b, repo scoped
  to tenant-b returns null → 404. RED before fix.
- [x] 1.3 Confirmed RED (4 new tests failing) before fix was applied.
  Note: `bash tests/blackbox/run.sh` is run for regression only (145/145 green).

## 2. Fix repository layer

- [x] 2.1 Add optional `tenantId?: string` parameter to `findById` in
  `services/backup-status/src/operations/operations.repository.ts`
- [x] 2.2 Build SQL conditionally: `AND tenant_id = $2` only when `tenantId != null`;
  params `[id, tenantId]` or `[id]` accordingly. Applied to both `.ts` and `.js`.
- [x] 2.3 Audited all callers of `findById` in the service: only
  `operation-dispatcher.{ts,js}` calls it without tenant context. That caller is
  intentionally left unchanged; it works correctly with the optional-param signature.

## 3. Fix action layer

- [x] 3.1 In `get-operation.action.{ts,js}::main`, call `repo.findById(operationId, token.tenantId)`.
  Cross-tenant IDs return null → uniform 404.
- [x] 3.2 Added defensive tenant check AFTER findById: `if (operation.tenantId !== token.tenantId) return 404`.
  Eliminates existence oracle even in edge cases. Within-tenant authz check (non-owner without
  global → 403) is preserved for same-tenant access. Applied to both `.ts` and `.js`.

## 4. Verify

- [x] 4.1 `cd services/backup-status && npx vitest run test/unit/operations/get-operation.action.test.ts`
  → 9/9 tests pass (5 original + 4 new IDOR reproduction tests).
- [x] 4.2 `cd services/backup-status && npx vitest run` → 109 passed, 3 failed (pre-existing
  integration/fallback failures, same as baseline). No regressions.
- [x] 4.3 `npm run typecheck` → clean (no errors).
- [x] 4.4 `bash tests/blackbox/run.sh` → 145/145 pass, 0 failures.
- [x] 4.5 `openspec validate fix-backup-operation-fetch-idor --strict` → valid.
