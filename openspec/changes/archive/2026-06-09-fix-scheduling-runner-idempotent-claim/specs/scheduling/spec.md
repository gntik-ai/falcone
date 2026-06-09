## ADDED Requirements

### Requirement: Job runner MUST atomically claim an execution before invoking the target action

The system SHALL use a compare-and-set UPDATE (`WHERE id = $1 AND started_at IS NULL`) to claim a scheduled execution before calling the target action, and SHALL skip invocation and return a `skipped` response if no row is claimed, ensuring that duplicate runner invocations for the same `executionId` produce exactly one target-action call.

#### Scenario: Duplicate runner invocation is skipped (bbx-runner-idempotency)

- **WHEN** the job runner action is invoked twice with the same `executionId` and the first invocation has already claimed the execution (set `started_at`)
- **THEN** the second invocation returns `{ skipped: true }` and does NOT call `params.invokeAction` a second time

#### Scenario: First runner invocation proceeds normally

- **WHEN** the job runner action is invoked with an `executionId` whose `started_at` is NULL
- **THEN** the execution is claimed (started_at set), `params.invokeAction` is called exactly once, and the execution record is finalized with the correct outcome

### Requirement: Skipped duplicate invocations MUST NOT alter the execution record

The system SHALL NOT overwrite `started_at`, `finished_at`, `duration_ms`, `error_summary`, or `status` on an execution row that has already been claimed by a previous runner invocation.

#### Scenario: Second invocation leaves execution record intact

- **WHEN** the job runner is invoked a second time for an already-claimed `executionId`
- **THEN** the execution record in `scheduled_executions` retains the `started_at`, `status`, and outcome values written by the first invocation, unchanged
