## 1. Failing black-box test

- [ ] 1.1 Add test `bbx-tokenhash-credential` to `tests/blackbox/`: initiate a restore to obtain a pending confirmation request; read the `token_hash` from the test database; call confirm-restore with `confirmation_token=<token_hash>`; assert HTTP 404 (not found) and no state change
- [ ] 1.2 Add a companion positive test: call confirm-restore with the original raw random token (issued at initiate time); assert HTTP 202 (accepted)
- [ ] 1.3 Run `bash tests/blackbox/run.sh` and confirm `bbx-tokenhash-credential` FAILS (red) before the fix is applied

## 2. Fix repository layer

- [ ] 2.1 In `services/backup-status/src/confirmations/confirmations.repository.ts::ConfirmationsRepository.findByTokenHash` (line 112), replace the conditional expression `const tokenHash = /^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)` with the unconditional `const tokenHash = hashToken(tokenOrHash)`
- [ ] 2.2 Verify that no other caller in the same file or in the module-level exported wrapper passes a pre-hashed value

## 3. Refactor abort to eliminate token_hash-as-credential

- [ ] 3.1 Add `ConfirmationsService.abortById(requestId: string, actor: Actor): Promise<ConfirmRestoreResult>` that: (a) fetches the request via `findById(requestId)`; (b) throws 404 if not found; (c) executes the abort state machine (update decision to 'aborted', emit `restore.aborted` audit event) without calling `findByTokenHash` or `confirm`
- [ ] 3.2 Replace the body of the module-level `abort` export in `confirmations.service.ts` (lines 578-582) to call `defaultService.abortById(confirmationRequestId, actor)` — remove the `findById` + `confirm({ confirmationToken: request.tokenHash })` pattern entirely
- [ ] 3.3 Audit all remaining call sites of `findByTokenHash` across the service and confirm none pass a value sourced from `request.tokenHash` or a database column

## 4. Verify

- [ ] 4.1 Run `bash tests/blackbox/run.sh` and confirm `bbx-tokenhash-credential` is green
- [ ] 4.2 Confirm the positive test (raw token confirm flow) is also green
- [ ] 4.3 Confirm the abort flow still works end-to-end via a legitimate test calling the abort path
