# scheduling Specification

## Purpose
TBD - created by archiving change fix-scheduling-enforce-cron-floor. Update Purpose after archive.
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

