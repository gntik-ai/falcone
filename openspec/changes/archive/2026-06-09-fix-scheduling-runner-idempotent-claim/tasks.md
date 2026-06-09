## 1. Failing black-box test

- [ ] 1.1 Add test `bbx-runner-idempotency` to `tests/blackbox/`: create a job, trigger one execution row, invoke the runner twice with the same `executionId`; assert `params.invokeAction` is called exactly once (first invocation) and the second invocation returns `{ skipped: true }`
- [ ] 1.2 Extend `bbx-runner-idempotency`: assert the execution record's `started_at`, `status`, and outcome fields match those written by the first invocation after both calls complete
- [ ] 1.3 Run `bash tests/blackbox/run.sh` and confirm `bbx-runner-idempotency` FAILS (red) before the fix is applied

## 2. Fix runner claim step

- [ ] 2.1 In `services/scheduling-engine/actions/scheduling-job-runner.mjs::main`, change the UPDATE at line 19 to: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 AND started_at IS NULL RETURNING *`
- [ ] 2.2 Add a null-check immediately after the UPDATE: if the returned row is absent (`!started`), return `{ statusCode: 200, body: { skipped: true, reason: 'already_claimed' } }` without proceeding to `params.invokeAction`

## 3. Verify

- [ ] 3.1 Run `bash tests/blackbox/run.sh` and confirm `bbx-runner-idempotency` is now green
- [ ] 3.2 Confirm no regression in existing runner success/failure/timeout tests
