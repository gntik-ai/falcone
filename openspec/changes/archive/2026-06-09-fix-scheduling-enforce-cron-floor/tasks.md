## 1. Failing black-box test

- [x] 1.1 Add test `bbx-cron-floor` to `tests/blackbox/`: configure a workspace with `minIntervalSeconds=3600`, then POST `/v1/scheduling/jobs` with `cronExpression: "* * * * *"`; assert HTTP 422 with `{ "code": "CRON_BELOW_FLOOR" }` and no job inserted
- [x] 1.2 Extend `bbx-cron-floor`: for an existing job, PATCH `/v1/scheduling/jobs/:id` with `cronExpression: "*/5 * * * *"` (300 s interval); assert HTTP 422 with `{ "code": "CRON_BELOW_FLOOR" }` and job cron unchanged
- [x] 1.3 Run `bash tests/blackbox/run.sh` and confirm `bbx-cron-floor` FAILS (red) before the fix is applied

## 2. Fix POST handler

- [x] 2.1 In `services/scheduling-engine/actions/scheduling-management.mjs`, add `assertCronFloor` to the import from `../src/quota.mjs`
- [x] 2.2 In the POST handler (after `validateCronExpression` succeeds, config already loaded at line 147), call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)` wrapped in a try/catch; on thrown Error return `errorResponse(422, 'CRON_BELOW_FLOOR', error.message)`

## 3. Fix PATCH handler

- [x] 3.1 In the PATCH handler (lines 234-251 of `scheduling-management.mjs`), when `params.body.cronExpression` is present, load the workspace config via `getConfig(pg, identity.tenantId, identity.workspaceId)`
- [x] 3.2 Call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)` and return `errorResponse(422, 'CRON_BELOW_FLOOR', error.message)` on violation, before the UPDATE query executes

## 4. Verify

- [x] 4.1 Run `bash tests/blackbox/run.sh` and confirm `bbx-cron-floor` is now green
- [x] 4.2 Confirm no regression in existing scheduling job create/update/list tests
