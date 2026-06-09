## Context

`scheduling-job-runner.mjs::main` is invoked by the scheduling trigger (`scheduling-trigger.mjs`) per execution row. The trigger guards against inserting duplicate execution rows with `ON CONFLICT (job_id, scheduled_at) DO NOTHING`, which prevents the same scheduled slot from yielding multiple rows. However, once a row exists and its `executionId` is dispatched (via `params.invokeRunner`), the runner action itself can be invoked more than once for the same ID — OpenWhisk provides at-least-once delivery semantics, and any orchestration retry (e.g., a network failure between dispatch and acknowledgment) re-delivers the invocation.

The runner's current claim step is `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1` (line 19). There is no predicate on the current state of `started_at`. A second concurrent or sequential invocation therefore:
1. Overwrites `started_at` with a newer timestamp.
2. Proceeds to call `params.invokeAction` (the tenant's target action) a second time.
3. Overwrites the execution outcome fields written by the first invocation.

The fix is a single-predicate change to the UPDATE: adding `AND started_at IS NULL`. This is a standard compare-and-set pattern (optimistic lock) — if the row was already claimed, zero rows are returned and the runner exits cleanly without calling the target action.

## Goals / Non-Goals

**Goals:**
- Make the runner idempotent with respect to the `executionId`: exactly one invocation of `params.invokeAction` per execution, regardless of delivery count.
- Leave the execution record (outcome, timings) written by the first invocation intact.

**Non-Goals:**
- Changing the trigger's deduplication logic.
- Handling the case where a runner crashes mid-execution and the execution needs to be re-driven (that is a separate "stale execution recovery" concern, not addressed here).
- Adding distributed locking beyond the database-level compare-and-set.

## Decisions

**Decision: Use `AND started_at IS NULL` as the claim predicate.**
Rationale: `started_at` is set exclusively by the runner's claim step and is NULL before any invocation. It is the natural idempotency sentinel. A zero-row UPDATE is the reliable signal that another invocation already holds the claim. No additional columns or state flags are needed.

**Decision: Return `{ skipped: true, reason: 'already_claimed' }` on a duplicate.**
Rationale: A `200` with a `skipped` payload is consistent with the existing early-exit path (job not active, line 15). OpenWhisk treats any non-5xx response as a successful activation; this avoids spurious retries while making the skip observable in activation logs.

## Risks / Trade-offs

**Risk:** A runner that crashes after claiming (`started_at` set) but before finalizing leaves the execution in a semi-claimed, non-final state indefinitely.
**Mitigation:** This is a pre-existing gap (stale execution recovery). The idempotency fix does not worsen it; a separate watchdog/reaper task should eventually handle rows stuck in `running` beyond a timeout. That is out of scope for this change.

**Risk:** Under very high concurrency, two runner invocations may both see `started_at IS NULL` simultaneously and both attempt the UPDATE; only one will match (the other will get zero rows). The database serializes the write; no double-execution occurs.
**Mitigation:** Postgres UPDATE is serialized at the row level; the predicate guarantees exactly-one claim. No further locking is needed.

## Migration Plan

No schema changes required. `started_at` is already nullable in `scheduled_executions`. The migration is a single-line predicate addition in `scheduling-job-runner.mjs`:

1. Change line 19 from `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 RETURNING *` to `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 AND started_at IS NULL RETURNING *`.
2. Add a null-check on the result: if `started` (the returned row) is undefined/null, return `{ statusCode: 200, body: { skipped: true, reason: 'already_claimed' } }`.
3. Add and run the `bbx-runner-idempotency` black-box test (failing first, green after fix).
