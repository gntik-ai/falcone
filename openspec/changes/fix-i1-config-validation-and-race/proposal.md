## Why

`PATCH /v1/scheduling/config` accepts unvalidated quota values and is racy
under concurrent operator edits. From
`openspec/audit/cap-i1-scheduling-engine.md`:

- **B10** (`services/scheduling-engine/src/config-model.mjs:31-54`) —
  `upsertConfig` writes `max_active_jobs`, `min_interval_seconds`, and
  `max_consecutive_failures` straight from the patch body. Negative numbers,
  zero, NaN, and arbitrarily large integers all persist. Setting
  `max_active_jobs: -1` permanently locks the workspace out
  (`0 < -1` is false → every create returns `409 QUOTA_EXCEEDED`);
  `min_interval_seconds: 0` disables the rate floor.
- **B12** (same file:line) — `upsertConfig` calls `getConfig` first and then
  INSERT/UPSERT. Two concurrent PATCH operators both read the same baseline
  and clobber each other's changes; last-write-wins on the entire row.
- **G6-G10** — same surface: no validation on the three quota fields, no
  per-job paused-event when scheduling is bulk-disabled, and the read-then-
  write race is flagged separately.

## What Changes

- Validate the three quota fields at the action layer (before they reach
  `upsertConfig`): `max_active_jobs` ∈ `[1, 1000]`, `min_interval_seconds`
  ∈ `[1, 86400]`, `max_consecutive_failures` ∈ `[1, 100]`. Reject with
  `400 INVALID_CONFIG` and a per-field error map on violation.
- Replace `upsertConfig`'s read-then-merge with a single atomic statement:
  `INSERT … ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET col = COALESCE(EXCLUDED.col, scheduling_configurations.col)`
  fed only by patched fields, eliminating the race.
- Take an advisory lock per `(tenant_id, workspace_id)` for the duration of
  the PATCH transaction to serialise concurrent operator edits and surface a
  `409 CONFIG_LOCKED` to the loser instead of silent overwrite.
- Emit a per-job `jobPausedEvent` in addition to `capabilityToggledEvent`
  when scheduling is bulk-disabled (G-S2.2), so audit consumers tracking per-
  job state observe the transition.

## Capabilities

### Modified Capabilities

- `functions-runtime`: scheduling config PATCH validates quota bounds,
  serialises concurrent edits, and emits per-job paused events on bulk
  disable.

## Impact

- Affected code: `services/scheduling-engine/src/config-model.mjs`,
  `services/scheduling-engine/actions/scheduling-management.mjs`,
  `services/scheduling-engine/src/audit.mjs`.
- Migrations: none (advisory lock + ON CONFLICT semantics; existing schema
  already has the UNIQUE).
- Breaking changes: PATCH calls with out-of-range values now receive
  `400 INVALID_CONFIG`; concurrent operators now see `409 CONFIG_LOCKED`
  rather than silent overwrite.
- Out of scope: per-workspace audit suppression rules for the new per-job
  paused events — addressed if/when audit volume becomes a problem.
