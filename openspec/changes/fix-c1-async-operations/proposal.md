## Why

Three confirmed bugs in the async-operation engine of `services/provisioning-orchestrator/` violate the operation state machine and lose audit/event signals. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B3.1** (`async-operation-retry-override.mjs:52`) — the UPDATE that resets an operation to `pending` lacks a `status IN ('failed','manual_intervention_required')` guard. An operation already in `completed`/`timed_out`/`cancelled` can be reset to `pending` by a superadmin retry-override; the state machine is broken.
- **B3.2** (`async-operation-retry.mjs:44-49`) — the `retry_attempts` row is inserted before `atomicResetToRetry` succeeds. If the atomic reset returns null (another writer beat us), the attempt row is orphaned and the subsequent legitimate retry collides with the `UNIQUE(operation_id, attempt_number)` constraint.
- **B3.3** (`async-operation-transition.mjs:91-96`) — a UNIQUE_VIOLATION on the manual-intervention-flag insert is caught and warn-logged. The second concurrent transition therefore does not republish `…manual-intervention-required`, so a downstream notifier may never fire and a human is never paged for the operation.

These are not safety nets; they are silent corruption of the operation lifecycle.

## What Changes

- Add the `status IN (...)` guard to the `retry-override` UPDATE; on guard miss return 409 with `INVALID_STATE_FOR_OVERRIDE`.
- Re-order `async-operation-retry` so the `retry_attempts` row is inserted only after `atomicResetToRetry` returns non-null, inside the same transaction.
- On UNIQUE_VIOLATION in the manual-intervention-flag insert, fetch the existing flag row and re-emit `…manual-intervention-required` (idempotent on `correlation_id`) rather than silently warn-logging.

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: tightens async-operation state-machine guards, retry-attempt creation ordering, and manual-intervention event idempotency.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs`, `services/provisioning-orchestrator/src/actions/async-operation-retry.mjs`, `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs`.
- Migrations: no (the existing UNIQUE constraint is unchanged).
- Breaking changes: callers that previously got 200 from `retry-override` against a `completed` operation will now get 409 — the documented contract.
- Out of scope: failure-code cache invalidation (B3.4), idempotency TTL race (B3.5), orphan-sweep retry_attempts gap (B3.6) — all covered by `harden-c1-async-operation-retry`.
