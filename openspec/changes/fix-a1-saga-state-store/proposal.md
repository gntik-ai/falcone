## Why

The saga state store under `apps/control-plane/src/saga/` carries four confirmed
correctness bugs that compromise idempotency and recovery — the two properties the
component exists to guarantee. From `openspec/audit/cap-a1-unified-public-api-contract.md`:

- **B1** (`saga-state-store.mjs:124-127` + `saga-engine.mjs:61-64`) — idempotency
  lookup is keyed on `(idempotencyKey, tenantId)` only; `workflow_id` is dropped.
  A tenant that reuses the same idempotency key across two workflows receives the
  *other* workflow's output.
- **B3** (`saga-state-store.mjs:10-15`) — the Postgres adapter import is wrapped in
  `.catch(() => ({}))` and the per-call helper falls back to `{ rows: [] }`. If
  the adapter fails to load, every INSERT/UPDATE silently no-ops; `executeSaga`
  reports success while persisting nothing; `recoverInFlightSagas` sees nothing
  to recover. Fail-open on the most critical state path in the platform.
- **B5** (`saga-engine.mjs:155`) — the in-flight recovery filter is `step => ['succeeded',
  'compensating', 'compensation-failed'].includes(step.status)`. Successful steps and
  permanently-failed compensations are re-handed to `compensateSaga` on every sweep
  with no backoff visible in this file.
- **B6** (`saga-engine.mjs:139-141`) — `recordIdempotencyResult` is only called after
  the happy path completes. Crashes between start and end leave the idempotency
  record un-finalized; combined with B1, retries can collide with another workflow's
  pending row.

## What Changes

- Add `workflow_id` to the idempotency lookup predicate and to the `saga_instances`
  uniqueness constraint.
- Replace the silently-swallowed dynamic adapter import with a fail-fast loader
  that throws on missing adapter and surfaces every query error to the caller.
- Rewrite the recovery-eligibility filter to (a) exclude `succeeded`, (b) cap
  retries on `compensation-failed` with exponential backoff stored on the row,
  (c) leave `compensating` for the normal compensation path.
- Persist an `in-progress` idempotency record at saga start so a mid-saga crash is
  observable to retries; the record graduates to `succeeded`/`failed` at terminal
  states.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: requirement on saga idempotency, persistence
  reliability, and in-flight recovery semantics.

## Impact

- **Affected code**: `apps/control-plane/src/saga/saga-state-store.mjs`,
  `apps/control-plane/src/saga/saga-engine.mjs`, `apps/control-plane/src/saga/saga-compensation.mjs`.
- **Migration required**: new `saga_idempotency_records` unique index covering
  `(idempotency_key, tenant_id, workflow_id)`; existing rows must be backfilled
  with their `workflow_id` from the parent `saga_instances` row.
- **Breaking changes**: tenant retries that previously cross-matched between
  workflows will now get a 409 — this is the intended behaviour and matches the
  contract every other BaaS in the space publishes.
- **Cross-cutting**: any consumer that relied on the silent no-op for "lazy
  bootstrap" must be updated; surface this in the change PR description.
