## Why

`scheduling-management.mjs::main` (POST jobs, lines 146-176; PATCH job, lines 234-251) validates the cron expression for syntax only (`validateCronExpression`) and checks the active-job-count quota, but never enforces the per-workspace minimum-interval floor stored in `config.min_interval_seconds`. The helper `quota.mjs::assertCronFloor` delegates to `cron-validator.mjs::assertAboveFloor` (line 75), which computes the minimum firing interval from the expression and throws when it falls below the floor — but neither function is ever called from the create or update paths. `config.min_interval_seconds` is read only to format the GET-config and PATCH-config responses (lines 91, 119). A workspace whose plan sets `min_interval_seconds=3600` can still register `* * * * *` (every 60 s), silently bypassing its scheduling-frequency quota.

## What Changes

- In the POST `/v1/scheduling/jobs` handler (lines 146-176 of `scheduling-management.mjs`), after `validateCronExpression` passes, call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)` and return `422 CRON_BELOW_FLOOR` on violation.
- In the PATCH `/v1/scheduling/jobs/:id` handler (lines 234-251), when `params.body.cronExpression` is present, load the workspace config and call `assertCronFloor` before applying the update; return `422 CRON_BELOW_FLOOR` on violation.
- Import `assertCronFloor` from `../src/quota.mjs` in `scheduling-management.mjs` (it is already exported; it is simply never imported or called).
- Add a black-box test `bbx-cron-floor` that sets `minIntervalSeconds=3600`, attempts to POST and PATCH a job with `* * * * *`, and asserts `422` with error code `CRON_BELOW_FLOOR`.

## Capabilities

### New Capabilities

- `scheduling`: Cron expression floor (`min_interval_seconds`) is enforced at job-create and job-update time; expressions whose minimum firing interval is below the workspace floor are rejected with 422.

### Modified Capabilities

## Impact

- `services/scheduling-engine/actions/scheduling-management.mjs::main` (POST handler lines 146-176; PATCH handler lines 234-251)
- `services/scheduling-engine/src/quota.mjs::assertCronFloor` (defined, currently never called from management action)
- `services/scheduling-engine/src/cron-validator.mjs::assertAboveFloor` (line 75, transitively)
