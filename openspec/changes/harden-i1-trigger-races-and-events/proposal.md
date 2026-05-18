## Why

The scheduling trigger and runner exhibit several race conditions and
operational gaps that produce duplicate audit events, fragile string
comparisons, missing pagination, and no graceful shutdown. From
`openspec/audit/cap-i1-scheduling-engine.md`:

- **B13** (`services/scheduling-engine/actions/scheduling-trigger.mjs:43-46`) —
  concurrent trigger invocations both emit `executionMissedEvent` for the
  same scheduled slot; the `ON CONFLICT DO NOTHING` dedupes the row but the
  audit emit runs regardless.
- **B14** (`scheduling-trigger.mjs:65-67`) — the trigger's UPDATE on
  `scheduled_jobs` is keyed by `id` only; same cross-tenant write risk as
  the runner before B7 was fixed.
- **B15** (`scheduling-trigger.mjs:32`) — the missed-window loop's exit
  condition `candidate === job.next_run_at` compares ISO strings; sub-second
  drift causes the loop to insert a missed-row that collides with the
  about-to-be-inserted current-run row.
- **B19** (`actions/scheduling-management.mjs:158`) — LIST orders by
  `id ASC` and limits to 100; no offset or cursor exists, so pagination
  beyond the first page is impossible.
- **B20** (`actions/scheduling-job-runner.mjs` whole module) — runner has no
  SIGTERM handling; in-flight executions stay `running` forever after a
  shutdown.
- **G13-G16, G19, G20** — same surface (audit duplication, no advisory lock,
  fake `nextCursor`, no orphan sweep).

## What Changes

- Hoist `executionMissedEvent` emission so it fires only after the missed-
  row INSERT returns a non-zero rowcount (i.e., on real first observation),
  eliminating duplicates under concurrent triggers.
- Scope the trigger's UPDATE at `:65-67` by
  `(id, tenant_id, workspace_id)` using the row's own values; matches the
  runner fix.
- Replace the ISO-string equality at `:32` with a numeric millisecond
  comparison (`Date.parse(candidate) >= Date.parse(job.next_run_at)`).
- Introduce real cursor pagination on `GET /jobs`: the response carries
  `nextCursor` derived from `(created_at, id)`; subsequent calls accept
  `?cursor=…` and append the keyset predicate. Drop the misleading
  hard-coded `null`.
- Add a SIGTERM-aware shutdown path to the runner: on signal, the runner
  stops accepting new invocations, finishes in-flight work with a 30s
  budget, then exits. Add an orphan sweep that flips `running` executions
  older than `2 * job-timeout` to `failed` with reason `RUNNER_TERMINATED`.

## Capabilities

### Modified Capabilities

- `functions-runtime`: scheduling trigger emits missed events once per real
  observation, trigger UPDATEs are tenant-scoped, the LIST endpoint supports
  cursor pagination, and the runner shuts down gracefully with an orphan
  sweep.

## Impact

- Affected code: `services/scheduling-engine/actions/scheduling-trigger.mjs`,
  `services/scheduling-engine/actions/scheduling-job-runner.mjs`,
  `services/scheduling-engine/actions/scheduling-management.mjs`.
- Migrations: none (cursor uses existing `created_at` + `id`).
- Breaking changes: API consumers that ignored `nextCursor` and assumed all
  rows fit in the first 100 will now see paginated responses; intentional.
- Out of scope: cross-replica trigger leader election — addressed by the
  existing OpenWhisk single-instance assumption, not in this proposal.
