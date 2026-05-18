## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/confirmations/confirmations.service.test.ts`
      where `resolveSnapshotCreatedAt` returns null; assert the
      confirmation flow rejects with `SNAPSHOT_AGE_UNAVAILABLE`, not a
      `normal` risk classification on a fresh-looking snapshot.
- [ ] 1.2 [test] Add a case to
      `services/backup-status/src/second-factor/otp-verifier.test.ts`
      submitting `otpCode = ''`; assert the verifier returns
      `INVALID_OTP_FORMAT` without making an HTTP call.
- [ ] 1.3 [test] Add a case to
      `services/backup-status/src/operations/risk-calculator.test.ts`
      where `isOutsideOperationalHours = true` and otherwise normal
      inputs; assert the risk classification is `elevated`, not `normal`.
- [ ] 1.4 [test] Add a case to `confirmations.service.test.ts` where
      OTP verification fails; assert a `restore.second_factor_failed`
      audit event is emitted with the original failure code.

## 2. Implementation

- [ ] 2.1 [fix] In `confirmations.service.ts:162-169`, replace the
      `new Date()` fallback with `throw new BlockingPrecheckError(
      'SNAPSHOT_AGE_UNAVAILABLE')`; surface as a precheck failure.
- [ ] 2.2 [fix] In `otp-verifier.ts:32`, validate `otpCode` matches
      `/^\d{6,8}$/` before any fetch; return
      `{ valid: false, error: 'INVALID_OTP_FORMAT' }` on miss.
- [ ] 2.3 [fix] In `confirmations.service.ts:240`, pass the actual
      `isOutsideOperationalHours` value (computed from the operational-
      hours precheck output) rather than `false`.
- [ ] 2.4 [fix] In `confirmations.service.ts`, wrap OTP and
      second-actor verification rejections with an audit emission of
      `restore.second_factor_failed` carrying the failure code.

## 3. Validation

- [ ] 3.1 [test] Re-run L1 confirmation + risk + OTP test suites and
      `openspec validate fix-l1-confirmations-and-otp --strict`; all
      green.
- [ ] 3.2 [docs] Update the restore-confirmation section of
      `services/backup-status/README.md` with the new
      `SNAPSHOT_AGE_UNAVAILABLE` / `INVALID_OTP_FORMAT` codes and the
      `restore.second_factor_failed` event.
