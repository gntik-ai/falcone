## Why

Two likely bugs in plan-assignment harden the path that `fix-c1-plan-lifecycle` corrects elsewhere; both touch `plan-assignment-repository.mjs`. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B1.4** (`plan-assignment-repository.mjs:29`) — `SET LOCAL lock_timeout` is built by interpolating `resolveLockTimeoutMs()` into the SQL string. The value is internal but the pattern is brittle; any future change that makes the lock-timeout configurable from a request shape would become an SQL injection vector.
- **B1.5** (`plan-assignment-repository.mjs:87-92`) — quota/capability impact inserts are issued inside a loop with no rollback if one row fails. A failure on impact row N leaves rows 1..N-1 persisted while the assignment supersede is still in flight; downstream readers see an inconsistent impact table.

These are not "wrong today" but they remove the only safety net the assignment writer has when impact computation drifts.

## What Changes

- Parameterize `lock_timeout` via `pg-format` or a SET-LOCAL `current_setting('app.lock_timeout_ms')::int * '1 ms'::interval` pattern; remove string interpolation.
- Wrap the impact-insert loop in the same transaction as the supersede; on any failure, the whole assignment write rolls back together.

## Capabilities

### Modified Capabilities

- `quota-and-billing`: tightens the SQL hygiene of the plan-assignment lock-timeout setter and makes the impact-insert loop transactional with supersede.

## Impact

- Affected code: `services/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs`.
- Migrations: no schema change.
- Breaking changes: none — internal hardening.
- Out of scope: plan-assign tenant-existence handling (B1.1 — `fix-c1-plan-lifecycle`), history insert overwrite (B1.2 — `fix-c1-plan-lifecycle`).
