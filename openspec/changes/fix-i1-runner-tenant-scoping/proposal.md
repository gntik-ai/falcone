## Why

The scheduling runner reads jobs by id alone and the management layer's
target-action validator is silently optional. Both make tenant boundaries
unenforceable in practice. From `openspec/audit/cap-i1-scheduling-engine.md`:

- **B7** (`services/scheduling-engine/actions/scheduling-job-runner.mjs:13`) —
  `SELECT * FROM scheduled_jobs WHERE id = $1`. No tenant or workspace filter.
  Any caller able to invoke the runner with a forged `jobId` executes against
  another tenant's row; the runner emits audit events with the *true* tenant
  read from the row, so the wrong workspace's actions fire under the wrong
  invocation context.
- **B8** (`services/scheduling-engine/actions/scheduling-management.mjs:46-52`) —
  `requireTargetAction` is a DI callback. If `params.validateTargetAction` is
  not wired by the upstream runtime, validation is silently skipped and any
  `targetAction` string is accepted.
- **G5** (cross-cutting) — silent-skip pattern flagged as fail-open.
- **G22, G23** (G-S7.1) — runner trusts the caller; no fallback if
  `invokeAction` is absent at runtime.

## What Changes

- Extend the runner's contract: `{jobId, executionId, tenantId, workspaceId,
  scheduledAt, correlationId}`; rewrite the SELECT to
  `WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3`. A missing or
  mismatching row MUST return `{skipped: true, reason: 'JOB_NOT_FOUND'}` and
  log an `executionOrphanedEvent`.
- Make `requireTargetAction` mandatory: if `params.validateTargetAction` is
  not supplied, the action MUST throw at module load
  (`SCHEDULING_VALIDATE_TARGET_ACTION_MISSING`) rather than silently skipping.
  The OpenWhisk binding manifest already supplies it; production deployments
  fail loud if the wiring breaks.
- Update the trigger (`scheduling-trigger.mjs`) to pass `tenantId` and
  `workspaceId` to `invokeRunner`.

## Capabilities

### Modified Capabilities

- `functions-runtime`: runner job-lookup is tenant- and workspace-scoped, and
  target-action validation is required rather than DI-optional.

## Impact

- Affected code: `services/scheduling-engine/actions/scheduling-job-runner.mjs`,
  `services/scheduling-engine/actions/scheduling-trigger.mjs`,
  `services/scheduling-engine/actions/scheduling-management.mjs`.
- Migrations: none.
- Breaking changes: a runner invocation lacking `tenantId`/`workspaceId` now
  returns `{skipped: true}` rather than executing; any deployment that omits
  `validateTargetAction` wiring fails loud at startup.
- Coordination: confirm the OpenWhisk binding sets `validateTargetAction` for
  the scheduling-management action before merging.
