## Why

Three confirmed bugs in the plan-lifecycle subsystem of `services/provisioning-orchestrator/` undermine the integrity of plan assignment and audit. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B1.1** (`plan-assign.mjs:24-27`) — `ensureTenantExists` catches PostgreSQL `42P01` (undefined_table) and returns `true`. If the `tenants` table is missing or renamed the action proceeds to insert a `tenant_plan_assignments` row against a non-existent tenant, producing orphan assignment rows the rest of the system trusts.
- **B1.2** (`plan-change-history-repository.mjs:59`) — the history insert uses `ON CONFLICT (plan_assignment_id) DO UPDATE`, so any retry silently overwrites prior history for the same assignment. The change history is supposed to be append-only.
- **B1.3** (`plan-capability-audit-query.mjs:46-47`) — the response surface advertises a `plan_slug` field, but the underlying `SELECT` at `:17-18` does not project the column from `plan_audit_events` (the table has no such column). Callers receive silent NULLs in every row.

These three bugs together mean (a) we can attach plans to ghosts, (b) we cannot trust the historical record of who attached what, and (c) the capability-audit query lies about what it returns. Each is a small, localised fix.

## What Changes

- Replace the `42P01`-swallow in `plan-assign.mjs` with a hard failure that surfaces missing-table as a 500-class error.
- Change `plan-change-history-repository.mjs` insert to a strict `INSERT` (no `ON CONFLICT`); rely on the assignment-supersede flow to write a new history row per change.
- Either project `plan_slug` in the `plan-capability-audit-query` SELECT (joining `plans` on `plan_id`) or remove the field from the response shape; spec mandates the projection path.

## Capabilities

### Modified Capabilities

- `quota-and-billing`: tightens plan-assignment integrity, plan-change-history append-only semantics, and plan-capability-audit response correctness.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/plan-assign.mjs`, `services/provisioning-orchestrator/src/repositories/plan-change-history-repository.mjs`, `services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs`.
- Migrations: no schema migration required; behaviour-only fix.
- Breaking changes: callers that previously received silent-NULL `plan_slug` will now receive a populated value; callers that previously tolerated missing-tenant assignments will get a clean error instead of orphan rows.
- Out of scope: plan-assignment locking (covered by `harden-c1-plan-assignments`), other plan actions, and downstream impact tables.
