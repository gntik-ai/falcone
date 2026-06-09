## Context

`scheduling-management.mjs::main` validates submitted cron expressions with `validateCronExpression` (syntax only) before inserting or updating jobs. The workspace config table stores `min_interval_seconds`, which is already loaded in the POST path (line 147) and is returned in the GET-config and PATCH-config responses (lines 91, 119). The floor-enforcement helper chain — `quota.mjs::assertCronFloor` → `cron-validator.mjs::assertAboveFloor` (line 75) — is fully implemented: `assertAboveFloor` computes the two shortest consecutive intervals from the expression and throws if either is below the floor. However, neither `assertCronFloor` nor `assertAboveFloor` is imported or called anywhere in the job-create or job-update code path. The PATCH path does not load config at all, so the floor value is not even available there currently.

## Goals / Non-Goals

**Goals:**
- Enforce `min_interval_seconds` at job-create (POST) and job-update (PATCH) time by calling the already-correct `assertCronFloor` helper.
- Return a distinct, machine-readable error code (`CRON_BELOW_FLOOR`) so clients can surface a user-friendly message.
- Load config in the PATCH handler when `cronExpression` is provided, so the floor value is available.

**Non-Goals:**
- Changing the floor-computation logic in `cron-validator.mjs` or `quota.mjs`.
- Retroactively re-validating already-stored jobs against new floor values (a separate migration concern).
- Altering how the `min_interval_seconds` config value is set or stored.

## Decisions

**Decision: Use the existing `assertCronFloor` / `assertAboveFloor` helpers unchanged.**
Rationale: The helpers are already correct and tested in isolation. The sole fix is to call them at the right point in the management action. No new logic is introduced; this is a call-site gap fix.

**Decision: Return HTTP 422 (Unprocessable Entity) with `CRON_BELOW_FLOOR`.**
Rationale: The submitted cron expression is syntactically valid (422, not 400) but violates a business rule (the workspace floor). 422 is consistent with how other semantic validation errors are handled in the codebase. `CRON_BELOW_FLOOR` is a clear, stable error code that clients and operators can match.

**Decision: Load config in the PATCH path only when `cronExpression` is present in the body.**
Rationale: Most PATCH calls update name/payload/targetAction without changing the cron expression; adding an unconditional config fetch would add a DB round-trip for every PATCH. The floor is only meaningful when the expression changes.

## Risks / Trade-offs

**Risk:** Existing jobs with a cron expression below the floor (created before this fix) will continue to run until they are next PATCHed.
**Mitigation:** Document the retroactive-revalidation gap; a follow-up migration task can sweep `scheduled_jobs` for sub-floor expressions and set them to `paused`.

**Risk:** `assertAboveFloor` computes `minimumIntervalSeconds` by probing two consecutive runs from a fixed reference date. Expressions with DST-induced gaps may yield inconsistent results.
**Mitigation:** The reference date is UTC-fixed (`2026-01-01T00:00:00.000Z`); no DST ambiguity applies. This risk is accepted for the current implementation scope.

## Migration Plan

No schema changes required. The change is entirely in `scheduling-management.mjs`:

1. Add `assertCronFloor` to the import from `../src/quota.mjs`.
2. In the POST handler, after `validateCronExpression` succeeds and config is already loaded, call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)`; catch the thrown Error and return `422 CRON_BELOW_FLOOR`.
3. In the PATCH handler, when `params.body.cronExpression` is present, load config and call `assertCronFloor`; catch and return `422 CRON_BELOW_FLOOR`.
4. Add and run the `bbx-cron-floor` black-box test suite entry (failing first, then green after the fix).
