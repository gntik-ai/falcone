# scheduling Specification

## Purpose
TBD - created by archiving. Update Purpose after archive.
## Requirements
### Requirement: Job creation MUST enforce the workspace cron floor

The system SHALL call `assertCronFloor(cronExpression, config.min_interval_seconds)` on every POST `/v1/scheduling/jobs` request after the cron expression passes syntax validation, and SHALL return HTTP 422 with error code `CRON_BELOW_FLOOR` when the expression's minimum firing interval is below the workspace-configured floor.

#### Scenario: POST job with sub-floor cron is rejected (bbx-cron-floor)

- **WHEN** a workspace has `min_interval_seconds=3600` and an actor submits POST `/v1/scheduling/jobs` with `cronExpression: "* * * * *"` (fires every 60 s)
- **THEN** the system returns HTTP 422 with `{ "code": "CRON_BELOW_FLOOR" }` and does not insert a job record

#### Scenario: POST job with cron at or above floor is accepted

- **WHEN** a workspace has `min_interval_seconds=3600` and an actor submits POST `/v1/scheduling/jobs` with `cronExpression: "0 * * * *"` (fires every 3600 s)
- **THEN** the system returns HTTP 201 and inserts the job record

### Requirement: Job update MUST enforce the workspace cron floor

The system SHALL call `assertCronFloor(cronExpression, config.min_interval_seconds)` on every PATCH `/v1/scheduling/jobs/:id` request that includes a `cronExpression` field, and SHALL return HTTP 422 with error code `CRON_BELOW_FLOOR` when the expression's minimum firing interval is below the workspace-configured floor.

#### Scenario: PATCH job cronExpression with sub-floor value is rejected (bbx-cron-floor)

- **WHEN** a workspace has `min_interval_seconds=3600` and an actor submits PATCH `/v1/scheduling/jobs/:id` with `cronExpression: "*/5 * * * *"` (fires every 300 s)
- **THEN** the system returns HTTP 422 with `{ "code": "CRON_BELOW_FLOOR" }` and does not update the job record

#### Scenario: PATCH without cronExpression field is not affected by floor check

- **WHEN** a PATCH `/v1/scheduling/jobs/:id` request body does not include a `cronExpression` field
- **THEN** the system does not invoke the floor check and processes the update normally

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

