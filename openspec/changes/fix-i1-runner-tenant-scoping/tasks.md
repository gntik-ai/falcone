## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `tests/integration/scheduling-job-runner.test.mjs` that calls the runner
      with `{jobId: <T_B's job>, tenantId: 'T_A', workspaceId: 'WS_A'}` and
      asserts the response is `{skipped: true, reason: 'JOB_NOT_FOUND'}` and
      no row in `T_B` is mutated, proving B7 at
      `scheduling-job-runner.mjs:13`.
- [ ] 1.2 [test] Add a case to
      `tests/integration/scheduling-management-action.test.mjs` that loads the
      action with `params.validateTargetAction` absent and asserts the module
      throws `SCHEDULING_VALIDATE_TARGET_ACTION_MISSING` rather than accepting
      the request, proving B8 at `scheduling-management.mjs:46-52`.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the runner's SELECT at
      `scheduling-job-runner.mjs:13` to
      `SELECT * FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`,
      reading the new `tenantId` and `workspaceId` params.
- [ ] 2.2 [fix] On a missing or mismatching row, return
      `{skipped: true, reason: 'JOB_NOT_FOUND'}` and emit
      `executionOrphanedEvent` via `publishAudit`.
- [ ] 2.3 [fix] Update `scheduling-trigger.mjs` to pass `tenantId` and
      `workspaceId` (read from the candidate row) into the
      `invokeRunner({jobId, executionId, tenantId, workspaceId, scheduledAt,
      correlationId})` call.
- [ ] 2.4 [fix] In `scheduling-management.mjs:46-52`, replace the silent-skip
      with a top-of-module guard: if `params.validateTargetAction` is not a
      function, throw `SCHEDULING_VALIDATE_TARGET_ACTION_MISSING` immediately.
- [ ] 2.5 [impl] Add an `executionOrphanedEvent` builder to
      `services/scheduling-engine/src/audit.mjs` mirroring the existing event
      shape (`{eventType: 'execution.orphaned', jobId, attemptedTenantId,
      actualTenantId, correlationId}`).

## 3. Validation

- [ ] 3.1 [docs] Document the runner's new required params and the orphan
      event in `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:integration` and
      `corepack pnpm test:contract`; both green before merge.
