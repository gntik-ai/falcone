# Scheduling job runner has no execution-claim guard (double-run on duplicate invocation)

| Field | Value |
|---|---|
| Change ID | `fix-scheduling-runner-idempotent-claim` |
| Capability | `scheduling` |
| Type | bug |
| Priority | P2 |
| OpenSpec change | `openspec/changes/fix-scheduling-runner-idempotent-claim/` |

## Why

`scheduling-job-runner.mjs::main` claims an execution with an unconditional UPDATE: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1` (line 19). There is no predicate on the current value of `started_at`. Under OpenWhisk at-least-once delivery, a network hiccup, or any duplicate dispatch, the same `executionId` can be delivered to the runner twice. The second invocation finds `started_at` already set, overwrites it, calls `params.invokeAction` a second time, and overwrites the execution record's outcome. The trigger deduplicates execution-row insertion via `ON CONFLICT (job_id, scheduled_at) DO NOTHING` (`scheduling-trigger.mjs:52`), preventing duplicate rows, but does not prevent duplicate runner invocations for the same row.

## What Changes

- Replace the unconditional UPDATE in `scheduling-job-runner.mjs::main` (line 19) with an atomic claim: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 AND started_at IS NULL RETURNING *`.
- If the UPDATE returns zero rows (execution already claimed), immediately return `{ statusCode: 200, body: { skipped: true, reason: 'already_claimed' } }` without calling `params.invokeAction`.

## Spec delta (EARS)

**Requirement: Job runner MUST atomically claim an execution before invoking the target action**
The system SHALL use a compare-and-set UPDATE (`WHERE id = $1 AND started_at IS NULL`) to claim a scheduled execution before calling the target action, and SHALL skip invocation and return a `skipped` response if no row is claimed, ensuring that duplicate runner invocations for the same `executionId` produce exactly one target-action call.

**Requirement: Skipped duplicate invocations MUST NOT alter the execution record**
The system SHALL NOT overwrite `started_at`, `finished_at`, `duration_ms`, `error_summary`, or `status` on an execution row that has already been claimed by a previous runner invocation.

Full delta in `openspec/changes/fix-scheduling-runner-idempotent-claim/specs/scheduling/spec.md`.

## Tasks

1. Add failing black-box test `bbx-runner-idempotency` (invoke runner twice for same `executionId`, assert `invokeAction` called once, second returns `{ skipped: true }`).
2. Change the UPDATE at line 19 to add `AND started_at IS NULL`.
3. Add null-check after the UPDATE; return `{ skipped: true, reason: 'already_claimed' }` when no row claimed.
4. Run `bash tests/blackbox/run.sh` — green.

Full checklist in `openspec/changes/fix-scheduling-runner-idempotent-claim/tasks.md`.

## Acceptance criteria

- **bbx-runner-idempotency:** Runner invoked twice with the same `executionId`; assert `params.invokeAction` fires exactly once, and second response is `{ skipped: true }`.
- After both invocations, execution record's `started_at`, `status`, and outcome fields match those of the first invocation (unchanged by the second).
- Single-invocation path continues to work correctly (no regression).

## Code evidence

- `services/scheduling-engine/actions/scheduling-job-runner.mjs::main` — line 19: `UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 RETURNING *` — no `AND started_at IS NULL` predicate; unconditional claim allows double-execution.
- `services/scheduling-engine/actions/scheduling-job-runner.mjs::main` — line 24: `params.invokeAction(...)` called immediately after the unconditional UPDATE with no guard on the result.
- `services/scheduling-engine/actions/scheduling-trigger.mjs` — line 52: `ON CONFLICT (job_id, scheduled_at) DO NOTHING` deduplicates row insertion but does not prevent duplicate runner invocations.

## Resolution (OpenSpec)

```
/opsx:apply fix-scheduling-runner-idempotent-claim
/opsx:verify fix-scheduling-runner-idempotent-claim
bash tests/blackbox/run.sh
/opsx:archive fix-scheduling-runner-idempotent-claim
```

Shorthand: `/fix-bug fix-scheduling-runner-idempotent-claim`

Optional real-stack E2E: `/e2e-issue fix-scheduling-runner-idempotent-claim`
