## Why

The scheduling schema is missing DB-level CHECK constraints, and two action-
layer code paths can produce inconsistent rows. From
`openspec/audit/cap-i1-scheduling-engine.md`:

- **B4** (`services/scheduling-engine/actions/scheduling-management.mjs:183`
  + trigger missed-window) — paused-then-resumed jobs synthesise phantom
  missed-execution rows because `last_triggered_at` is not reset on resume;
  the trigger walks forward from the pre-pause timestamp and produces up to
  `SCHEDULING_MISSED_WINDOW_CAP` spurious `executionMissedEvent`s.
- **B17** (`services/scheduling-engine/migrations/001-scheduling-tables.sql`,
  `scheduled_jobs.status`) — the column has no `CHECK (status IN (…))`
  constraint; any string can be written by a buggy UPDATE and state-machine
  reasoning then misbehaves silently.
- **B18** (`scheduling-management.mjs:203-220`) — `PATCH /jobs/{id}` accepts
  a new `targetAction` without re-validating reachability when
  `requireTargetAction` is omitted; combined with B8 the validator can be
  silently skipped.
- **G27, G28, G29** (G-DB.1-DB.3) —
  `scheduling_configurations.UNIQUE(tenant_id, workspace_id)` treats NULL
  workspace as distinct so two tenant-default rows can coexist;
  `scheduled_executions.UNIQUE(job_id, scheduled_at)` is the only dedup so
  two concurrent runners can both write `started_at`.

## What Changes

- Add migration `002-scheduling-status-checks.sql`:
  - `CHECK (status IN ('active', 'paused', 'errored', 'deleted'))` on
    `scheduled_jobs`.
  - `CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out',
    'missed'))` on `scheduled_executions`.
  - `CREATE UNIQUE INDEX … ON scheduling_configurations (tenant_id) WHERE
    workspace_id IS NULL` to enforce single-tenant-default row.
- On resume (`scheduling-management.mjs:174-187`) reset `last_triggered_at =
  next_run_at` so the trigger's missed-window walk starts at the resume
  point, eliminating phantom missed events (B4).
- Re-validate the target action whenever `PATCH /jobs/{id}` changes
  `targetAction`, calling `requireTargetAction` unconditionally; the
  mandatory-validator change from `fix-i1-runner-tenant-scoping` makes the
  fail-loud path consistent.

## Capabilities

### Modified Capabilities

- `functions-runtime`: scheduling schema enforces status enums, a single
  tenant-default config row, and resume semantics that prevent phantom
  missed-execution events.

## Impact

- Affected code: new
  `services/scheduling-engine/migrations/002-scheduling-status-checks.sql`,
  `services/scheduling-engine/actions/scheduling-management.mjs`.
- Migrations: yes, additive CHECK constraints + one partial unique index;
  validates against existing rows. Backfill: existing rows are already in
  the enum (the action layer is the only writer); the migration verifies
  the assertion first and aborts if a stray value is found.
- Breaking changes: a future bug that writes an out-of-enum `status` now
  fails the INSERT/UPDATE with a constraint violation rather than persisting
  silently; intentional.
- Coordination: deploy this migration after `fix-i1-sql-injection` so the
  enum is already enforced at the action layer; otherwise the LIST handler's
  enum check is the only protection.
