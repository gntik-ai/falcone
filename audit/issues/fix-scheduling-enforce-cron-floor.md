# Scheduling cron floor (min_interval_seconds) never enforced — quota bypass

| Field | Value |
|---|---|
| Change ID | `fix-scheduling-enforce-cron-floor` |
| Capability | `scheduling`, `quotas-plans` |
| Type | bug |
| Priority | P2 |
| OpenSpec change | `openspec/changes/fix-scheduling-enforce-cron-floor/` |

## Why

`scheduling-management.mjs::main` validates submitted cron expressions for syntax only (`validateCronExpression`) and checks the active-job-count quota, but never enforces the per-workspace minimum-interval floor (`config.min_interval_seconds`). The helper `quota.mjs::assertCronFloor` delegates to `cron-validator.mjs::assertAboveFloor` (line 75), which computes the minimum firing interval and throws on a floor violation — but neither function is imported or called from the create or update paths. `config.min_interval_seconds` is read only for display in the GET-config and PATCH-config responses (lines 91, 119). A workspace whose plan sets `min_interval_seconds=3600` can still register `* * * * *` (every 60 s), generating up to 60x the intended trigger volume.

## What Changes

- In the POST `/v1/scheduling/jobs` handler, after `validateCronExpression` passes, call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)` and return `422 CRON_BELOW_FLOOR` on violation.
- In the PATCH `/v1/scheduling/jobs/:id` handler, when `params.body.cronExpression` is present, load workspace config and call `assertCronFloor`; return `422 CRON_BELOW_FLOOR` on violation.
- Import `assertCronFloor` from `../src/quota.mjs` in `scheduling-management.mjs` (exported but never imported).

## Spec delta (EARS)

**Requirement: Job creation MUST enforce the workspace cron floor**
The system SHALL call `assertCronFloor(cronExpression, config.min_interval_seconds)` on every POST `/v1/scheduling/jobs` request after syntax validation succeeds, and SHALL return HTTP 422 with error code `CRON_BELOW_FLOOR` when the expression's minimum firing interval is below the configured floor.

**Requirement: Job update MUST enforce the workspace cron floor**
The system SHALL call `assertCronFloor(cronExpression, config.min_interval_seconds)` on every PATCH `/v1/scheduling/jobs/:id` request that includes a `cronExpression` field, and SHALL return HTTP 422 with error code `CRON_BELOW_FLOOR` when the expression's minimum firing interval is below the configured floor.

Full delta in `openspec/changes/fix-scheduling-enforce-cron-floor/specs/scheduling/spec.md`.

## Tasks

1. Add failing black-box test `bbx-cron-floor` (POST and PATCH sub-floor cron, assert 422 CRON_BELOW_FLOOR).
2. Import and call `assertCronFloor` in the POST handler.
3. Load config and call `assertCronFloor` in the PATCH handler when `cronExpression` is present.
4. Run `bash tests/blackbox/run.sh` — green.

Full checklist in `openspec/changes/fix-scheduling-enforce-cron-floor/tasks.md`.

## Acceptance criteria

- **bbx-cron-floor (POST):** Workspace with `minIntervalSeconds=3600` + POST `cronExpression: "* * * * *"` → HTTP 422, `{ "code": "CRON_BELOW_FLOOR" }`, no job inserted.
- **bbx-cron-floor (PATCH):** Same workspace + PATCH existing job with `cronExpression: "*/5 * * * *"` → HTTP 422, `{ "code": "CRON_BELOW_FLOOR" }`, job cron unchanged.
- POST and PATCH with a cron at or above the floor succeed as before (no regression).

## Code evidence

- `services/scheduling-engine/actions/scheduling-management.mjs::main` — POST handler lines 146-176: calls `validateCronExpression` but not `assertCronFloor`; config loaded at line 147 has `min_interval_seconds` available but unused for floor enforcement.
- `services/scheduling-engine/actions/scheduling-management.mjs::main` — PATCH handler lines 234-251: calls `validateCronExpression` when `cronExpression` present but no floor check; config not loaded in this path.
- `services/scheduling-engine/src/quota.mjs::assertCronFloor` — exported at line 15-17, never imported by `scheduling-management.mjs`.
- `services/scheduling-engine/src/cron-validator.mjs::assertAboveFloor` — implemented at line 75-78, correct, never transitively called from management action.

## Resolution (OpenSpec)

```
/opsx:apply fix-scheduling-enforce-cron-floor
/opsx:verify fix-scheduling-enforce-cron-floor
bash tests/blackbox/run.sh
/opsx:archive fix-scheduling-enforce-cron-floor
```

Shorthand: `/fix-bug fix-scheduling-enforce-cron-floor`

Optional real-stack E2E: `/e2e-issue fix-scheduling-enforce-cron-floor`
