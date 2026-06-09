## Why

`scheduling-job-runner.mjs::main` (lines 11-35) claims an execution with an unconditional UPDATE: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1`. There is no guard on the current value of `started_at`; if the runner is invoked twice with the same `executionId` — possible under OpenWhisk at-least-once delivery, a webhook retry, or any duplicate dispatch — the second invocation finds `started_at` already set, proceeds anyway, calls `params.invokeAction` a second time, and overwrites the execution record's outcome. The trigger deduplicates insertion of execution rows via `ON CONFLICT (job_id, scheduled_at) DO NOTHING` (`scheduling-trigger.mjs:52`), preventing duplicate rows; but it does not prevent the same `executionId` from being dispatched twice to the runner, and the runner has no compare-and-set to detect that condition.

## What Changes

- Replace the unconditional `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1` in `scheduling-job-runner.mjs::main` with an atomic claim: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 AND started_at IS NULL RETURNING *`.
- If the UPDATE returns zero rows (execution already claimed), immediately return `{ statusCode: 200, body: { skipped: true, reason: 'already_claimed' } }` without calling `params.invokeAction`.
- The existing `const started = ...` assignment continues to hold the row; the null-check on its return value becomes the idempotency gate.

## Capabilities

### New Capabilities

- `scheduling`: Job runner atomically claims an execution before invoking the target action; duplicate invocations of the same `executionId` are detected and skipped with no side effects.

### Modified Capabilities

## Impact

- `services/scheduling-engine/actions/scheduling-job-runner.mjs::main` (lines 11-35; specifically the UPDATE at line 19 and the missing guard before line 24)
