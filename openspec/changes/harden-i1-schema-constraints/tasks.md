## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `tests/integration/scheduling-trigger.test.mjs` that creates a job,
      pauses it for 2h, resumes it, then runs the trigger and asserts zero
      `executionMissedEvent`s are emitted, proving B4 at
      `scheduling-management.mjs:183`.
- [ ] 1.2 [test] Add a case to
      `tests/integration/scheduling-management-action.test.mjs` that
      directly executes `UPDATE scheduled_jobs SET status = 'banana'
      WHERE id = $1` and asserts the SQL fails with a CHECK constraint
      violation, proving B17 at the migration site.
- [ ] 1.3 [test] Add a case that creates two
      `scheduling_configurations` rows with `workspace_id IS NULL` for the
      same tenant and asserts the second INSERT fails with a unique
      violation, proving G27/G-DB.1.

## 2. Implementation

- [ ] 2.1 [migration] Create
      `services/scheduling-engine/migrations/002-scheduling-status-checks.sql`
      adding `CHECK (status IN ('active', 'paused', 'errored', 'deleted'))`
      on `scheduled_jobs.status` and the equivalent CHECK on
      `scheduled_executions.status`.
- [ ] 2.2 [migration] In the same migration, add
      `CREATE UNIQUE INDEX scheduling_configurations_tenant_default_uq
      ON scheduling_configurations (tenant_id) WHERE workspace_id IS NULL`.
- [ ] 2.3 [migration] Pre-flight the migration with a `SELECT 1 FROM
      scheduled_jobs WHERE status NOT IN (...)` assertion that aborts if a
      stray value exists.
- [ ] 2.4 [fix] In the resume branch at
      `scheduling-management.mjs:174-187`, set `last_triggered_at =
      next_run_at` alongside `applyNextRunAt` so the trigger's missed-window
      walk does not synthesise pre-pause runs.
- [ ] 2.5 [fix] In the PATCH handler at
      `scheduling-management.mjs:203-220`, call `requireTargetAction`
      unconditionally when `body.targetAction` is present; surface failures
      as `400 TARGET_ACTION_UNREACHABLE`.

## 3. Validation

- [ ] 3.1 [docs] Document the enum values, the single-tenant-default rule,
      and the resume reset behaviour in
      `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:integration` and the migration
      smoke test; green before merge.
