## Why

Four interacting defects in the delivery worker and retry scheduler
leave webhooks stuck or flapping. From
`openspec/audit/cap-f3-webhook-engine.md`:

- **B7** (`services/webhook-engine/actions/webhook-delivery-worker.mjs:11-27`)
  — `secret = secretRows.find(active) ?? secretRows[0]`. If
  `secretRows` is empty (manual cleanup, rotation race that revoked
  everything), `secret` is `undefined` and the next access at `:27`
  (`secret.secret`) throws `TypeError`. The delivery never advances
  and no `permanently_failed` transition fires.
- **B8** (`services/webhook-engine/actions/webhook-retry-scheduler.mjs:10`)
  — cancellation list is `['deleted', 'paused']`. `'disabled'` is
  absent. A subscription auto-disabled by the threshold logic at
  `:22-26` continues to retry; if one delivery succeeds, the worker
  emits `…delivery.succeeded` for a disabled subscription.
- **B12** (`services/webhook-engine/actions/webhook-retry-scheduler.mjs:22`
  vs `services/webhook-engine/migrations/001-webhook-subscriptions.sql:9`)
  — the scheduler reads `WEBHOOK_AUTO_DISABLE_THRESHOLD` from env,
  not the per-subscription `max_consecutive_failures` column. The
  column exists but is dead schema; per-subscription thresholds
  cannot be set.
- **B19** (`services/webhook-engine/actions/webhook-delivery-worker.mjs:37`)
  — `consecutive_failures` is reset only by `db.updateSubscription`.
  The success path does not patch the subscription, so a flapping
  webhook accumulates failures across successful runs.
- **G18** — `db.incrementSubscriptionFailures` atomicity is
  unspecified.

## What Changes

- Add a guard at the top of the worker: if `secretRows` is empty,
  mark the delivery `permanently_failed` with `error_detail:
  'no_signing_secret_available'` and emit
  `…delivery.permanently_failed`; do not throw.
- Extend the scheduler cancellation list to `['deleted', 'paused',
  'disabled']`; on cancellation, set delivery status to
  `'cancelled'` and emit no further audit events.
- Consult `subscription.max_consecutive_failures` (the column)
  before `WEBHOOK_AUTO_DISABLE_THRESHOLD` (the env) in the scheduler's
  auto-disable branch; document the precedence.
- In the worker's success path, atomically reset
  `subscription.consecutive_failures = 0` via a SQL update bound to
  the row's current value (CAS) so flapping does not accumulate
  failures.
- Add a contract assertion that
  `db.incrementSubscriptionFailures(id)` is implemented atomically
  (SQL `UPDATE … SET consecutive_failures = consecutive_failures + 1
  WHERE id = $1 RETURNING consecutive_failures`).

## Capabilities

### Modified Capabilities

- `realtime-and-events`: webhook deliveries advance through terminal
  states even in degenerate secret rotations; disabled subscriptions
  stop retrying; per-subscription failure thresholds become live; the
  flapping-counter bug is closed.

## Impact

- **Affected code**:
  `services/webhook-engine/actions/webhook-delivery-worker.mjs`,
  `services/webhook-engine/actions/webhook-retry-scheduler.mjs`,
  and the (out-of-package) DB layer's
  `incrementSubscriptionFailures` and `resetSubscriptionFailures`.
- **Migration**: none — `max_consecutive_failures` column already
  exists.
- **Breaking changes**: subscriptions auto-disabled and currently
  flapping `succeeded` will stop emitting `…delivery.succeeded`
  events; receivers should treat the absence as terminal.
- **Out of scope**: rate-limit / tenant isolation fixes
  (`fix-f3-rate-limit-and-tenant-isolation`).
