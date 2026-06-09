## 1. Failing black-box test

- [x] 1.1 Add test `B3` to `services/backup-status/test/unit/api/restore-tenant-binding.test.ts`: actor JWT tenant A, body OMITS tenant_id → expect 400 (required) and `confirm()` NOT called
- [x] 1.2 Add test `E1` (service layer): `ConfirmationsService.confirm` where `actor.tenantId = A` (no superadmin), `request.tenantId = B` → throws `ConfirmationError` 403 'access_denied'
- [x] 1.3 Add test `E2` (service layer): superadmin actor with mismatched tenant passes the gate (aborts successfully)
- [x] 1.4 Run vitest and confirm B3 and E1 FAIL (red) before the fix is applied

## 2. Fix service layer

- [x] 2.1 In `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.confirm`, add `const isSuperadmin = actor.scopes.includes('superadmin')` immediately after retrieving the request record
- [x] 2.2 Add early-return guard: `if (!isSuperadmin && actor.tenantId !== request.tenantId) { throw new ConfirmationError(403, 'access_denied') }` before any further decision logic (before the `!body.confirmed` branch and before `tenantNameConfirmation` check)

## 3. Fix action layer

- [x] 3.1 In `services/backup-status/src/api/confirm-restore.action.ts::main`, add `tenant_id` to the list of required body fields (currently only `confirmation_token` and `confirmed` are required)
- [x] 3.2 Remove the `typeof body.tenant_id === 'string'` conditional; enforce the `body.tenant_id !== token.tenantId` rejection unconditionally for non-superadmin callers

## 4. Verify

- [x] 4.1 Run vitest and confirm B3/E1/E2 are green; all 11 restore-tenant-binding tests pass
- [x] 4.2 Confirm the legitimate same-tenant confirm flow still returns HTTP 202 (B2 passes)
- [x] 4.3 Confirm the superadmin cross-tenant confirm flow still works (A3 passes, E2 passes)
- [x] 4.4 typecheck clean (`npm run typecheck` → no errors)
- [x] 4.5 `bash tests/blackbox/run.sh` → 145/145 pass, no regressions

## Notes on harness reconciliation

- tasks.md originally referenced `tests/blackbox/` but the backup-status action tests cannot be driven by `node --test` (TypeScript .js extension convention, vi.mock requirements). Tests live in `services/backup-status/test/unit/api/restore-tenant-binding.test.ts` (vitest), matching the pattern established by the prior fix (scope-restore-to-authenticated-tenant).
- `confirmations.service.js` is a one-line re-export barrel (`export * from './confirmations.service.ts'`) — fixing `.ts` is sufficient; no parallel `.js` edit needed.
- `operations.repository.js` vi.mock at the top of the test file was extended to include `create` so the service-layer E tests can use `vi.importActual` without hitting the vitest "No create export" error. This does not change mock semantics for A/B/C/D tests (they mock the entire service, not the repo).
