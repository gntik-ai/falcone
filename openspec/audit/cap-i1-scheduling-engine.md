# Capability I1 — Scheduling Engine

**Source locus:** `services/scheduling-engine/` — **697 LOC** across 9 source files plus one migration:

| File | LOC | Role |
|---|---|---|
| `actions/scheduling-management.mjs` | 233 | HTTP-shaped handler: config + jobs CRUD + pause/resume + executions list |
| `actions/scheduling-trigger.mjs` | 73 | Periodic poller: finds due jobs, fills missed-execution gaps, invokes runner |
| `actions/scheduling-job-runner.mjs` | 57 | Per-execution worker: invokes target action, finalises execution row |
| `src/audit.mjs` | 24 | Audit event builders (12 event types) |
| `src/config-model.mjs` | 71 | `getConfig`, `upsertConfig`, `getActiveJobsToSuspend` |
| `src/cron-validator.mjs` | 79 | Cron parsing, `nextRunAt`, `minimumIntervalSeconds`, `assertAboveFloor` |
| `src/execution-model.mjs` | 47 | Execution-record builders + `resolveOutcome` |
| `src/job-model.mjs` | 75 | Job record + state machine + failure counter |
| `src/quota.mjs` | 38 | Quota checks + default-limit reader |
| `migrations/001-scheduling-tables.sql` | 56 | 3 tables: `scheduling_configurations`, `scheduled_jobs`, `scheduled_executions` |

Tests: `tests/integration/scheduling-{management-action,trigger,job-runner}.test.mjs`, `tests/contracts/scheduling-api.contract.test.mjs`, `tests/e2e/workspace-scheduling/`.

**Method.** Read every file end-to-end (no file exceeds 233 LOC). Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

Up-front observations:
- `package.json` (`:6-9`) has a real `test` script pointing at unit/integration/contract tests under `../../tests/` and a real `eslint` lint command (not the placeholder stub seen elsewhere). The `cron-parser@^5.2.0` dependency is **declared but unused** — the module ships its own hand-rolled cron parser at `src/cron-validator.mjs`.
- All three actions follow the OpenWhisk-style `export default async function main(params)` shape, consistent with other action services. No HTTP/WS server here.
- Same `params.jwt?.* ?? params.*` upstream-trust pattern as F3/H1: tenant/workspace identity is trusted from the action params with a JWT-preferred fallback (`scheduling-management.mjs:15-22`).
- `cron-parser` is declared but unused (`package.json:12`). The hand-rolled parser has several bugs (see B5/B6).

---

## SPEC (what exists)

### S1. Identity & route shape

- **WHEN** `main(params)` runs in `scheduling-management.mjs`, **THE SYSTEM SHALL** parse identity as `{tenantId: jwt.tenantId ?? params.tenantId, workspaceId: jwt.workspaceId ?? params.workspaceId, actorId: jwt.sub ?? params.actorId ?? 'system', roles: jwt.roles ?? []}` (`:15-22`).
- **WHEN** a request arrives, **THE SYSTEM SHALL** strip the `/v1/scheduling` prefix and dispatch on path segments and HTTP method (`:58-60`).
- **WHEN** no route matches, **THE SYSTEM SHALL** return `404 NOT_FOUND` (`:229`).
- **WHEN** the handler throws, **THE SYSTEM SHALL** return `{statusCode: error.statusCode ?? 500, code: error.code ?? 'INTERNAL_ERROR', message: error.message}` (`:230-232`).

### S2. Configuration (`GET/PATCH /v1/scheduling/config`)

- **WHEN** `GET /config` runs, **THE SYSTEM SHALL** return `{schedulingEnabled, maxActiveJobs, minIntervalSeconds, maxConsecutiveFailures}` derived from `getConfig` (`:64-72`).
- **WHEN** `getConfig(pg, tenantId, workspaceId)` is called, **THE SYSTEM SHALL** look up the workspace-specific row, fall back to the tenant-default row (`workspace_id IS NULL`), and finally fall back to environment-driven defaults (`SCHEDULING_ENABLED_BY_DEFAULT='false'`, `SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS=10`, `SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS=60`, `SCHEDULING_DEFAULT_MAX_CONSECUTIVE_FAILURES=5`) (`config-model.mjs:3-29`, `quota.mjs:32-38`).
- **WHEN** `PATCH /config` runs, **THE SYSTEM SHALL** upsert the workspace config row, and if the patch carries `schedulingEnabled: false`, **THE SYSTEM SHALL** UPDATE every active workspace job to `'paused'` and emit a `capabilityToggledEvent` with `metadata.pausedJobCount` (`:74-100`).

### S3. Summary (`GET /v1/scheduling/summary`)

- **WHEN** `GET /summary` runs, **THE SYSTEM SHALL** aggregate per-status counts (`active`, `paused`, `errored`, `deleted`) and return `{activeJobs, pausedJobs, erroredJobs, deletedJobs, quotaLimit: config.max_active_jobs, quotaUsed: activeJobs, schedulingEnabled}` (`:103-122`).

### S4. Jobs CRUD (`/v1/scheduling/jobs[/{id}[/{pause|resume|executions}]]`)

- **WHEN** `POST /jobs` runs, **THE SYSTEM SHALL** (a) `getConfig`, (b) reject with `403 SCHEDULING_DISABLED` if `isSchedulingEnabled === false`, (c) validate cron syntax via `validateCronExpression`, (d) call `requireTargetAction` if `params.validateTargetAction` is supplied, (e) get the active-job count and reject with `409 QUOTA_EXCEEDED` if at limit (plus emit `quotaExceededEvent`), (f) build a `scheduled_jobs` row, INSERT it, emit `jobCreatedEvent`, return `201 mapJob(row)` (`:124-154`).
- **WHEN** `GET /jobs` runs, **THE SYSTEM SHALL** return up to `min(query.limit, 100)` jobs filtered by tenant+workspace+`deleted_at IS NULL`, optionally further filtered by `query.status` (`:156-162`) — see B1 for the SQL-injection bug here.
- **WHEN** `GET /jobs/{id}` runs, **THE SYSTEM SHALL** look up the job by `(id, tenantId, workspaceId)` and return `mapJob`; `404` if absent (`:189-193`).
- **WHEN** `PATCH /jobs/{id}` runs, **THE SYSTEM SHALL** require the job exists, optionally re-validate the new cron expression, optionally call `requireTargetAction`, recompute `next_run_at` only if `cronExpression` changed, UPDATE name/cron/target_action/payload/next_run_at, emit `jobUpdatedEvent`, return `200` (`:203-220`).
- **WHEN** `DELETE /jobs/{id}` runs, **THE SYSTEM SHALL** UPDATE status to `'deleted'`, set `deleted_at = now()`, emit `jobDeletedEvent`, return `204` (`:222-227`).
- **WHEN** `POST /jobs/{id}/pause` runs, **THE SYSTEM SHALL** require the job exists and has `status='active'`, apply state transition, UPDATE, emit `jobPausedEvent`, return `200` (`:164-172`).
- **WHEN** `POST /jobs/{id}/resume` runs, **THE SYSTEM SHALL** require status='paused', confirm scheduling is enabled, re-check quota, apply state transition + `applyNextRunAt`, UPDATE, emit `jobResumedEvent`, return `200` (`:174-187`).
- **WHEN** `GET /jobs/{id}/executions` runs, **THE SYSTEM SHALL** return up to `min(query.limit, 100)` execution rows for the job (newest first), with `{executionId, status, scheduledAt, startedAt, finishedAt, durationMs, errorSummary, correlationId}` (`:195-201`).

### S5. State machine and quotas

- **WHEN** state transitions are evaluated, **THE SYSTEM SHALL** permit `active → {paused, errored, deleted}`, `paused → {active, deleted}`, `errored → {deleted}`, and refuse any transition from `deleted` (`job-model.mjs:4-9`).
- **WHEN** an execution failure increments the failure counter, **THE SYSTEM SHALL** flip the job to `'errored'` if `consecutive_failure_count >= max_consecutive_failures` (`job-model.mjs:49-58`).
- **WHEN** `checkJobCreationQuota(activeCount, maxActiveJobs)` runs, **THE SYSTEM SHALL** return `{allowed: activeCount < maxActiveJobs, reason}` (`quota.mjs:3-9`).
- **WHEN** `assertAboveFloor(expr, floorSeconds)` is invoked, **THE SYSTEM SHALL** compute `minimumIntervalSeconds(expr)` and throw if below the floor (`cron-validator.mjs:75-79`, `quota.mjs:15-17`).

### S6. Trigger (cron poller)

- **WHEN** the trigger runs and `SCHEDULING_ENGINE_ENABLED === 'false'`, **THE SYSTEM SHALL** return `{triggered: 0, skipped: 'disabled'}` (`scheduling-trigger.mjs:12-14`).
- **WHEN** the trigger runs, **THE SYSTEM SHALL** select all `scheduled_jobs` with `status='active' AND deleted_at IS NULL AND next_run_at <= now` ordered by `next_run_at ASC` (`scheduling-trigger.mjs:18-21`).
- **WHEN** a job has `last_triggered_at` set, **THE SYSTEM SHALL** walk forward from that timestamp computing `nextRunAt(cron, probe)` and record each candidate < `now` as a missed execution (capped by `SCHEDULING_MISSED_WINDOW_CAP ?? 10`), inserting `(id, job_id, tenant_id, workspace_id, 'missed', scheduled_at, correlation_id, created_at)` with `ON CONFLICT (job_id, scheduled_at) DO NOTHING`, and emitting `executionMissedEvent` per missed run (`scheduling-trigger.mjs:27-46`).
- **WHEN** the current-run execution row is inserted, **THE SYSTEM SHALL** use `gen_random_uuid()`, status `'running'`, `scheduled_at = job.next_run_at`, with `ON CONFLICT DO NOTHING` (`scheduling-trigger.mjs:49-55`).
- **WHEN** insertion succeeded and `params.invokeRunner` is callable, **THE SYSTEM SHALL** invoke it with `{jobId, executionId, scheduledAt, correlationId}` (`:57-63`).
- **WHEN** the trigger advances the job, **THE SYSTEM SHALL** UPDATE `last_triggered_at = job.next_run_at` and `next_run_at = nextRunAt(cron, new Date(job.next_run_at))` (`:65-68`).

### S7. Runner (per-execution worker)

- **WHEN** the runner is invoked with `{jobId, executionId}`, **THE SYSTEM SHALL** load the job by `id` only (no tenant scoping — see B7), skip with `{skipped: true}` if the job is missing, not active, or soft-deleted (`scheduling-job-runner.mjs:11-16`).
- **WHEN** the runner runs, **THE SYSTEM SHALL** UPDATE the execution's `started_at`, call `params.invokeAction({targetAction, payload, correlationId})`, catch exceptions, compute `resolveOutcome(startedAt, finishedAt, result)`, and finalise the execution row with `{status: outcome, finished_at, duration_ms, error_summary}` (`:18-35`).
- **WHEN** the outcome is `'succeeded'`, **THE SYSTEM SHALL** UPDATE the job's `consecutive_failure_count = 0` and emit `executionSucceededEvent` (`:37-41`).
- **WHEN** the outcome is `'timed_out'` or `'failed'`, **THE SYSTEM SHALL** UPDATE the job's `consecutive_failure_count` (incremented) and `status` (potentially `'errored'`), emit the matching event, and if the new status is `'errored'` also emit `jobErroredEvent` (`:44-54`).
- **WHEN** `resolveOutcome(startedAt, finishedAt, result)` runs, **THE SYSTEM SHALL** return `'timed_out'` if `result.timeout === true` OR `finishedAt - startedAt > result.timeoutMs ?? Infinity`, else `'failed'` if `result.ok === false || result.error`, else `'succeeded'` (`execution-model.mjs:27-35`).

### S8. Audit emission

- **WHEN** any management/trigger/runner action concludes a significant event, **THE SYSTEM SHALL** call the supplied `params.publishAudit` callback (if any) with a typed event built by `audit.mjs` (one of 12 event types: `job.{created,updated,paused,resumed,deleted,errored}`, `execution.{succeeded,failed,timed_out,missed}`, `capability.toggled`, `quota.exceeded`) (`audit.mjs:13-25`, `scheduling-management.mjs:40-44`).

### S9. Persistence (migration 001)

- **WHEN** the migration runs, **THE SYSTEM SHALL** create `scheduling_configurations(id UUID PK, tenant_id TEXT NN, workspace_id TEXT NULLABLE, scheduling_enabled BOOL NN DEFAULT FALSE, max_active_jobs INT NN DEFAULT 10, min_interval_seconds INT NN DEFAULT 60, max_consecutive_failures INT NN DEFAULT 5, timestamps, UNIQUE(tenant_id, workspace_id))` plus an index on `tenant_id` (`migrations/001-scheduling-tables.sql:1-14`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `scheduled_jobs(id UUID PK, tenant_id, workspace_id, name, cron_expression, target_action, payload JSONB NN DEFAULT '{}', status TEXT NN DEFAULT 'active', consecutive_failure_count INT NN DEFAULT 0, max_consecutive_failures INT NN DEFAULT 5, next_run_at TIMESTAMPTZ, last_triggered_at TIMESTAMPTZ, created_by TEXT NN, timestamps, deleted_at)` with two partial indexes (`migrations/001-scheduling-tables.sql:16-36`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `scheduled_executions(id UUID PK, job_id UUID FK, tenant_id, workspace_id, status DEFAULT 'running', scheduled_at NN, started_at, finished_at, duration_ms INT, error_summary TEXT, correlation_id TEXT, created_at, UNIQUE(job_id, scheduled_at))` plus three indexes (`:38-56`).

---

## GAPS

### G-cross. Cross-cutting

1. **Identity is trusted from request params.** `scheduling-management.mjs:15-22` reads `jwt.tenantId ?? params.tenantId`. If the gateway forgets to validate JWT, a caller-supplied `params.tenantId` is accepted. Same pattern as F3, H1.
2. **Default `actorId: 'system'` when neither JWT nor explicit actor is supplied** (`:19`). Audit trail records `'system'` as the actor for unauthenticated callers.
3. **No scope/role authorization.** No `params.scopes` check anywhere; any caller with the right tenant/workspace identity is admin-capable.
4. **The `cron-parser` npm dependency is declared but unused** (`package.json:12`). The hand-rolled `cron-validator.mjs:34-79` parser has several bugs (see B5–B6). Either remove the dep or switch to it.
5. **`requireTargetAction` is a DI callback with silent skip.** `scheduling-management.mjs:46-52`. If `params.validateTargetAction` isn't wired, validation is silently skipped and any `targetAction` string passes.

### G-management

- **G-S2.1** `PATCH /config` (`:74-100`) accepts arbitrary `body.maxActiveJobs`, `body.minIntervalSeconds`, `body.maxConsecutiveFailures` and writes them to the DB without validation. Negative values, zero, NaN, or huge numbers all persist. See B10.
- **G-S2.2** When `PATCH /config` sets `schedulingEnabled: false`, active jobs are bulk-paused but no per-job `jobPausedEvent` is emitted — only a single `capabilityToggledEvent` with a `pausedJobCount` count. Audit consumers tracking per-job state get a gap.
- **G-S2.3** `upsertConfig` (`config-model.mjs:31-54`) calls `getConfig` first to merge the patch with current values, then INSERTs/upserts. Two concurrent PATCH calls can both read the same baseline and write conflicting values; last-write-wins.
- **G-S4.1** `POST /jobs` does **NOT** call `assertCronFloor` against `config.min_interval_seconds`. The floor exists in config and the helper exists in `quota.mjs:15-17` and `cron-validator.mjs:75-79`, but the management action never invokes it. A job with `cronExpression: '* * * * *'` (every minute) is accepted even if `min_interval_seconds = 3600`.
- **G-S4.2** `PATCH /jobs/{id}` similarly does not enforce `min_interval_seconds` when the cron changes (`:203-220`).
- **G-S4.3** `GET /jobs` (`:156-162`) interpolates `params.query.status` directly into SQL. See B1.
- **G-S4.4** Pagination is fake: `nextCursor: null` on both list endpoints (`:161, :200`).
- **G-S4.5** `PATCH /jobs/{id}` spreads `params.body` into the SQL without field allow-list. The current SQL only uses 4 named fields (name/cron/target_action/payload), so a stray `body.status` is ignored — but the code path is fragile if anyone adds a field via `${}` later.
- **G-S4.6** `DELETE /jobs/{id}` (`:222-227`) doesn't check the job's prior `status`. A `deleted` job re-deleted will UPDATE `deleted_at` (idempotent) but the `RETURNING *` makes it return success. OK behaviour, but the state-machine rule at `job-model.mjs:8` says `deleted → {}` (no transitions). The DELETE handler bypasses `applyTransition`.
- **G-S4.7** No `cancelPendingExecutions` on DELETE. A job deleted while an execution is pending will leave the execution row in `running` state. Compare with F3's webhook handler which does call `cancelPendingDeliveries`.

### G-trigger

- **G-S6.1** Missed-execution window uses `last_triggered_at` as the probe start (`scheduling-trigger.mjs:29`). When a job is paused-then-resumed, `applyNextRunAt` updates `next_run_at` to `nextRunAt(cron, now)` but leaves `last_triggered_at` unchanged. The next trigger cycle will then synthesise up to `SCHEDULING_MISSED_WINDOW_CAP` missed-execution rows for the pause window. See B4.
- **G-S6.2** `nextRunAt(expr, probe)` is called inside a `while (missed.length < missedCap)` loop. Each call is `O(60 * 24 * 366)` worst case (see G-S5.1). With cap=10 missed runs, that's up to ~5M iterations per trigger.
- **G-S6.3** Trigger does not honour any per-workspace `min_interval_seconds`. The cap is a global env-var, not per-tenant.
- **G-S6.4** No locking on `scheduled_jobs` selection. Two concurrent trigger invocations both see the same due job, both attempt the missed-window insert + current-run insert. The UNIQUE(job_id, scheduled_at) constraint dedupes the insert, and only the one that wins `RETURNING id` invokes the runner. OK as deduping, but both still do the per-job missed-window scan (wasted work and duplicate audit events for missed runs since `ON CONFLICT DO NOTHING` doesn't suppress `executionMissedEvent`).
- **G-S6.5** The trigger emits `executionMissedEvent` for every iteration of the missed loop, regardless of whether the row was a conflict-skip or a real insert. Audit duplicates under concurrent triggers.
- **G-S6.6** `params.correlationId` (set on line 54) is used for both the running execution and the runner invocation but not stamped on missed-execution rows (line 43 passes `record.correlation_id` which was generated by `buildMissedExecutionRecord` → `randomUUID` per row, not the trigger-level correlation).

### G-runner

- **G-S7.1** `SELECT * FROM scheduled_jobs WHERE id = $1` (`scheduling-job-runner.mjs:13`) — no tenant/workspace scoping. The runner trusts the caller (the trigger) to pass a valid id. See B7.
- **G-S7.2** `params.invokeAction` is required (no DI fallback). If absent at runtime, the throw is caught and the execution is marked failed — but the error message will be `'invokeAction is not a function'` rather than a structured code.
- **G-S7.3** `resolveOutcome` (`execution-model.mjs:27-35`) infers timeout from `result.timeoutMs ?? Infinity`. If the runner is called with a 5-min timeout and the action returns no `timeoutMs`, the runner cannot detect a timeout from elapsed time alone.
- **G-S7.4** No per-job timeout enforcement at the runner. The runner awaits `params.invokeAction(...)` without an `AbortSignal.timeout` wrapper. Compare with F3 webhook delivery which uses `AbortSignal.timeout(WEBHOOK_RESPONSE_TIMEOUT_MS)`.
- **G-S7.5** No retry-with-backoff at the runner; failures count against `consecutive_failure_count` immediately. There's no scheduling of a "retry now" between regular cron firings.

### G-cron-validator

- **G-S5.1** `nextRunAt` (`cron-validator.mjs:56-66`) does up to `60 * 24 * 366` minute-by-minute probes for sparse expressions (e.g., `0 0 29 2 *`). Combined with the missed-window loop in the trigger, worst-case CPU is high.
- **G-S5.2** Six-field rejection (line 36) blocks Quartz-style seconds-precision cron, but doesn't reject 7-field (year-suffix) GNU-style.

### G-database

- **G-DB.1** `scheduling_configurations.UNIQUE(tenant_id, workspace_id)` (`migrations:11`) treats `workspace_id IS NULL` as distinct in Postgres, so two tenant-default rows could coexist. No partial index or trigger enforces single-tenant-default uniqueness.
- **G-DB.2** `scheduled_jobs` lacks a `CHECK (status IN (…))` constraint. Any string can be written via UPDATE.
- **G-DB.3** `scheduled_executions.UNIQUE(job_id, scheduled_at)` is the only dedup; `(job_id, status='running')` is not constrained. Two concurrent runners on the same row could both write `started_at` (last-write-wins).
- **G-DB.4** `scheduled_jobs.deleted_at` is set but rows are never hard-deleted. Disk accumulates indefinitely.

### G-tests

- **G-T1** No test asserts the SQL-injection vector in `GET /jobs?status=...` (B1).
- **G-T2** No test asserts `min_interval_seconds` is enforced on job creation (G-S4.1 / B3).
- **G-T3** No test asserts paused-then-resumed jobs do not generate phantom missed executions (B4 / G-S6.1).
- **G-T4** No test asserts the runner rejects cross-tenant `jobId` (B7 / G-S7.1).

---

## BUGS

### Confirmed (verified-by-author from cited line ranges)

- **B1. SQL injection in `GET /v1/scheduling/jobs?status=…`.**
  `services/scheduling-engine/actions/scheduling-management.mjs:158` (verified-by-author):
  ```js
  `SELECT * FROM scheduled_jobs
     WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
     ${params.query?.status ? "AND status = '" + params.query.status + "'" : ''}
     ORDER BY id ASC LIMIT $3`
  ```
  `params.query.status` is concatenated **directly into the SQL string** with literal single quotes. A caller supplying `?status=x' OR '1'='1` reads every workspace's jobs across the tenant — and could escalate to other tables via `'; SELECT … FROM other; --`. This is the most severe correctness/security defect found in this audit pass.

- **B2. Identity trusts caller-supplied `params.tenantId` / `params.workspaceId` if JWT is missing.**
  `scheduling-management.mjs:15-22` (verified-by-author). The `jwt.tenantId ?? params.tenantId` fallback means an upstream that fails to attach JWT lets the caller set their own tenant. Same upstream-trust pattern flagged in F3 (B6) and H1 (B1).

- **B3. `min_interval_seconds` floor is never enforced.**
  `quota.mjs:15-17` exports `assertCronFloor`, and `cron-validator.mjs:75-79` implements it. Reading `scheduling-management.mjs` end-to-end shows it is **never called**. `POST /jobs` (`:124-154`) and `PATCH /jobs/{id}` (`:203-220`) both validate cron syntax via `validateCronExpression` but skip the floor check. Per-workspace `min_interval_seconds` config has no enforcement effect.

- **B4. Paused-then-resumed jobs generate phantom missed-execution rows.**
  Combination of `scheduling-management.mjs:183` (`applyNextRunAt(applyTransition(current, 'active'))`) and `scheduling-trigger.mjs:27-46` (missed loop starts from `job.last_triggered_at`). `last_triggered_at` is not reset on pause or resume. After resume, the trigger's next cycle walks from the original `last_triggered_at` (potentially hours/days ago) forward, capped by `SCHEDULING_MISSED_WINDOW_CAP=10`. Each of those becomes an `executionMissedEvent` even though the job was intentionally paused. Operators reading audit will see spurious "missed" runs.

- **B5. Weekday `7` is unreachable.**
  `cron-validator.mjs:5` declares `FIELD_RANGES[4] = [0, 7]` (weekday range 0–7 inclusive). Line 44: `weekdays.includes(weekday === 0 ? 0 : weekday)` — the ternary is a no-op (`x === 0 ? 0 : x` collapses to `x`); the apparent intent is to map `7 → 0` for Sunday or vice-versa. `date.getUTCDay()` returns `0..6`. So a cron expression like `* * * * 7` parses successfully (the expander accepts 7), but `matches()` looks for `7` in a set that contains only `{7}` (`expandPart('7', 0, 7)` → `[7]`) and compares against `weekday=0..6`. **The expression never matches.** Sunday-by-`7` cron expressions silently never fire.

- **B6. Six-field cron rejection is half-correct.**
  `cron-validator.mjs:36-37` rejects 6-field expressions with the message "seconds precision is not supported". But 7-field GNU-style (year-suffix) expressions pass the `!== 5` check and fail downstream. Detection is half-correct: 5-field only, but the error message is misleading for 7-field inputs.

- **B7. Runner has no tenant/workspace scoping on job lookup.**
  `scheduling-job-runner.mjs:13` (verified-by-author): `SELECT * FROM scheduled_jobs WHERE id = $1`. The runner trusts the caller. If the trigger's correlationId hand-off is intercepted, or if anyone else can invoke `webhook-engine-runner`-style with a forged `jobId`, the runner will execute against another tenant's row and emit audit events with the rightful tenant_id (read from the row) — but the invocation context (e.g., the action's secret resolution) would be off-tenant. Compounds with B2 if upstream lets `params.workspaceId` come from request.

- **B8. `requireTargetAction` is silently optional.**
  `scheduling-management.mjs:46-52` (verified-by-author). If `params.validateTargetAction` is not wired by the upstream OpenWhisk runtime, `targetAction` is accepted without any verification that the named action exists or is invocable for the workspace. A misconfigured deployment allows arbitrary strings.

- **B9. `actorId` defaults to `'system'` when JWT and explicit `actorId` are both absent.**
  `scheduling-management.mjs:19` (verified-by-author). Audit records every such call as a system action, polluting forensics.

- **B10. `PATCH /config` accepts unvalidated quota values, enabling lockout or unbounded jobs.**
  `config-model.mjs:31-54` (verified-by-author). No validation on `max_active_jobs`, `min_interval_seconds`, `max_consecutive_failures`. A caller can set `max_active_jobs: -1` (every subsequent create returns `409 QUOTA_EXCEEDED` because `0 < -1` is false → permanent lockout) or `max_active_jobs: 999999999` (effectively unlimited). Same vulnerability for `min_interval_seconds: 0` (no rate floor).

- **B11. `nextRunAt` in trigger uses `new Date(job.next_run_at)` and `nextRunAt(... new Date(job.next_run_at))` advances by 1 minute.**
  `cron-validator.mjs:60`: `probe.setUTCMinutes(probe.getUTCMinutes() + 1)`. If `job.next_run_at` is exactly at a minute boundary that matches the cron, the probe starts at `next_run_at + 1 minute`. The current trigger logic at `scheduling-trigger.mjs:67` calls `nextRunAt(job.cron_expression, new Date(job.next_run_at))` to compute the NEW `next_run_at` — meaning the new value is always `>= next_run_at + 1 minute`. For a cron expression `* * * * *` (every minute), this is correct. For `0 * * * *` (top of hour), if a trigger fires at 14:00:00, the new `next_run_at` is 15:00:00 — correct. **But the trigger doesn't account for clock drift or trigger-lateness**: if the trigger fires at 14:05 with `job.next_run_at = 14:00`, the new `next_run_at` is `nextRunAt('0 * * * *', Date('14:00'))` = `15:00`. The 14:05 firing covers the 14:00 slot. OK behaviour, but undocumented. Marked as confirmed because the code is reasoning-fragile.

### Likely (smells / leaks / race conditions)

- **B12. Two concurrent PATCH /config calls race on read-then-write.** `config-model.mjs:31-54` — `getConfig` then `INSERT … ON CONFLICT … DO UPDATE`. Last write wins; concurrent operators clobber each other.

- **B13. Concurrent trigger invocations duplicate `executionMissedEvent` emissions.** `scheduling-trigger.mjs:43-46`. The `ON CONFLICT DO NOTHING` dedupes the row insert, but `publishAudit` runs regardless. The event payload contains a per-row UUID so events appear distinct.

- **B14. No tenant/workspace scoping on `scheduled_jobs.id`-based UPDATE in trigger.** `scheduling-trigger.mjs:65-67` (`UPDATE scheduled_jobs SET … WHERE id = $1`). Same risk profile as B7, but for the trigger writing to whatever job id the candidate set returned.

- **B15. Missed-window loop probe condition `candidate === job.next_run_at` compares ISO strings.** `scheduling-trigger.mjs:32`. If `nextRunAt` returns an ISO with a different sub-second representation than what's stored in Postgres for `next_run_at`, the equality check fails and the loop continues to insert a missed row that collides with the about-to-be-inserted current-run row. Mitigated by the UNIQUE constraint, but the audit event still fires (per B13).

- **B16. `cron-validator.matches` weekday handling effectively treats `0` (Sunday) only via the ternary's first branch.** Combined with B5: if a cron expression uses `0` for Sunday (standard), `expandPart('0', 0, 7)` returns `[0]`, and `matches` checks `weekdays.includes(0)` for Sunday — works. The bug is only the `7`-meaning-Sunday case (B5).

- **B17. `scheduled_jobs.status` has no DB-level CHECK.** A bug in the action layer could write any string into `status`; queries and state-machine logic would then misbehave silently.

- **B18. `PATCH /jobs/{id}` does not validate that the new `targetAction` is reachable for the workspace if `requireTargetAction` is omitted (DI).** Same as B8 but for updates.

- **B19. `scheduling-management.mjs:158` LIST endpoint orders by `id ASC` and limits to 100; no offset/cursor.** Pagination beyond the first 100 jobs is impossible.

- **B20. Runner has no graceful shutdown path.** If the process receives SIGTERM mid-action, the in-flight execution row stays in `running` forever. No "orphan-sweep" exists to reconcile.

### Needs verification

- **B21. Whether `params.invokeAction` actually times out long-running actions.** `resolveOutcome` infers timeout from `result.timeoutMs ?? Infinity`. If the underlying invoker doesn't propagate a timeout, `'succeeded'` is returned for an action that ran forever.

- **B22. Whether the runner's `started_at` UPDATE can race against another invocation of the runner with the same `executionId`.** `scheduling-job-runner.mjs:19` — UPDATE without optimistic-lock token.

- **B23. Whether the cap `SCHEDULING_MISSED_WINDOW_CAP=10` is the same as the operator's expectation.** Operators who upgrade an instance and forget to set this env may see at most 10 missed events per trigger cycle even if hours of jobs were missed.

- **B24. Whether the `nextRunAt` `>= now` short-circuit in the trigger correctly handles DST transitions** (`scheduling-trigger.mjs:32`). The validator runs in UTC; if any test fixture uses local times, behaviour differs.

- **B25. `cron-parser@^5.2.0` is declared but unused.** Verify with a tree-shake check; if intent was to migrate to it, the migration is incomplete.

---

## Scope note for downstream spec authoring

I1 is a small, fully-resident-in-repo capability — no out-of-repo binary, real tests are wired into the package's own `pnpm test`, and the schema is clean. But several correctness/security items must block any spec proposal:

1. **B1 — SQL injection in `GET /jobs?status=…`.** The `+` concatenation must be replaced with parameterised binding (`AND status = $N`). This is the most severe defect found in the entire audit so far this session.
2. **B2 — Identity trust.** Decide whether the gateway is permitted to skip JWT (almost certainly not) and either remove the `params.tenantId` fallback or add an explicit signed-context check.
3. **B3 — `min_interval_seconds` enforcement.** Wire `assertCronFloor(expr, config.min_interval_seconds)` into both `POST /jobs` and `PATCH /jobs/{id}`. The plumbing already exists.
4. **B4 — phantom missed executions after pause/resume.** Either reset `last_triggered_at = next_run_at` on resume, or skip the missed-window loop when `last_triggered_at < pause_at`. Decide intent: "skip missed runs during pause" vs. "replay missed runs from pause start".
5. **B5 — weekday-7 cron support.** Either reject `7` at parse time (per Quartz vs. cron divergence) or map `7 → 0` correctly in `matches()`.
6. **B7 — runner tenant scoping.** Add `AND tenant_id = $2 AND workspace_id = $3` to the runner's SELECT. The trigger has the values available; the runner just needs to receive and check them.
7. **B10 — config validation.** Add bounds: `max_active_jobs >= 1`, `min_interval_seconds >= 1`, `max_consecutive_failures >= 1`, all with sensible upper bounds. Today's defaults are 10/60/5 — a hard upper bound like 1000/86400/100 would prevent foot-shooting.

Secondary cleanup: remove the unused `cron-parser` dependency, decide between hand-rolled validator (keep & fix) and `cron-parser` (delete the hand-rolled module), wire `cancelPendingExecutions` on job delete (analogous to F3's `cancelPendingDeliveries`), add an orphan-sweep for `status='running'` executions, and add a `CHECK` constraint on `scheduled_jobs.status`.
