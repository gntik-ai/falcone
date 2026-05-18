## Why

The hand-rolled cron validator under `services/scheduling-engine/src/` has
several latent correctness defects, and the `min_interval_seconds` floor that
exists in config is never enforced at job creation. From
`openspec/audit/cap-i1-scheduling-engine.md`:

- **B3** (`services/scheduling-engine/src/quota.mjs:15-17` + cron-validator) —
  `assertCronFloor(expr, floor)` is exported and implemented but `POST /jobs`
  (`actions/scheduling-management.mjs:124-154`) and `PATCH /jobs/{id}`
  (`:203-220`) never call it. Per-workspace `min_interval_seconds` has no
  enforcement.
- **B5** (`services/scheduling-engine/src/cron-validator.mjs:5,44`) — weekday
  field range is declared `[0, 7]` and the `matches()` ternary
  `weekdays.includes(weekday === 0 ? 0 : weekday)` collapses to a no-op.
  `* * * * 7` parses successfully but never matches any day; Sunday-by-`7`
  cron expressions silently never fire.
- **B6** (`cron-validator.mjs:36-37`) — six-field expressions are rejected with
  "seconds precision is not supported", but seven-field GNU-style year-suffix
  expressions pass the `!== 5` check and fail downstream with a misleading
  error.
- **B11** (`cron-validator.mjs:60`) — `nextRunAt` always advances by 1 minute
  before probing; the trigger's clock-drift semantics are undocumented and the
  fact that `next_run_at` is always `>= now + 1min` is reasoning-fragile.
- **G4, G18** (cross-cutting) — the unused `cron-parser` dep is declared and
  the floor enforcement gap is flagged.

## What Changes

- Wire `assertCronFloor(expr, config.min_interval_seconds)` into
  `POST /jobs` and `PATCH /jobs/{id}` (when `cronExpression` changes); reject
  with `400 CRON_BELOW_FLOOR` on violation.
- Fix the weekday range: declare `[0, 6]` and map `7 → 0` in `expandPart`
  before evaluation, so `* * * * 7` fires on Sunday.
- Make the 5-field check explicit: reject 6-field with `seconds precision is
  not supported`, reject 7-field with `year-suffix is not supported`, reject
  anything else with `cron expression must have exactly 5 fields`.
- Either remove `cron-parser` from `package.json` (`:12`) or migrate to it
  wholesale. Decision: remove the unused dep; the hand-rolled parser is small
  and now corrected.
- Document `nextRunAt`'s "always advances by ≥1 minute" semantic in the
  module header so the trigger contract is explicit.

## Capabilities

### Modified Capabilities

- `functions-runtime`: cron validation enforces the per-workspace interval
  floor, supports `7` as Sunday, and rejects 6/7-field expressions with
  distinct codes.

## Impact

- Affected code: `services/scheduling-engine/src/cron-validator.mjs`,
  `services/scheduling-engine/src/quota.mjs`,
  `services/scheduling-engine/actions/scheduling-management.mjs`,
  `services/scheduling-engine/package.json`.
- Migrations: none.
- Breaking changes: callers whose cron expression violates
  `min_interval_seconds` now receive `400 CRON_BELOW_FLOOR` instead of being
  silently accepted; callers using `* * * * 7` will now fire on Sunday rather
  than never (was a silent bug).
- Out of scope: switching the hand-rolled parser for `cron-parser`; tracked
  separately if performance becomes a concern.
