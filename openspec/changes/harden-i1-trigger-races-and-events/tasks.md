## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `tests/integration/scheduling-trigger.test.mjs` that fires two
      concurrent trigger invocations against the same due job and asserts
      exactly one `executionMissedEvent` per missed slot is observed,
      proving B13 at `scheduling-trigger.mjs:43-46`.
- [ ] 1.2 [test] Add a case that submits `GET /jobs` to a workspace with
      150 jobs and asserts the response carries a non-null `nextCursor` and
      that following the cursor returns the remaining 50 rows, proving B19
      at `scheduling-management.mjs:158`.

## 2. Implementation

- [ ] 2.1 [fix] Restructure `scheduling-trigger.mjs:43-46` so the missed-row
      INSERT returns `RETURNING id`; only emit `executionMissedEvent` when
      the rowcount is `1` (real insert), suppressing duplicates from
      `ON CONFLICT DO NOTHING` paths.
- [ ] 2.2 [fix] Tighten the trigger UPDATE at `scheduling-trigger.mjs:65-67`
      to `UPDATE scheduled_jobs SET … WHERE id = $1 AND tenant_id = $2 AND
      workspace_id = $3` using the candidate row's own values.
- [ ] 2.3 [fix] Replace the ISO-string compare at
      `scheduling-trigger.mjs:32` with
      `Date.parse(candidate) >= Date.parse(job.next_run_at)`.
- [ ] 2.4 [impl] Add keyset cursor support in
      `scheduling-management.mjs:156-162`: order by `(created_at ASC, id ASC)`,
      encode `cursor = base64({createdAt, id})`, accept `query.cursor`,
      append `AND (created_at, id) > ($X, $Y)`.
- [ ] 2.5 [impl] Add `process.on('SIGTERM', shutdownRunner)` in
      `scheduling-job-runner.mjs`: stop the work loop, wait up to 30s for
      in-flight `invokeAction` to finish, then exit.
- [ ] 2.6 [impl] Add an orphan-sweep query invoked from the trigger every
      cycle: `UPDATE scheduled_executions SET status = 'failed',
      error_summary = 'RUNNER_TERMINATED', finished_at = now() WHERE status
      = 'running' AND started_at < now() - interval '2 * job-timeout'`.

## 3. Validation

- [ ] 3.1 [docs] Document the cursor format, the SIGTERM contract, and the
      orphan-sweep cadence in `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:integration`; green before merge.
