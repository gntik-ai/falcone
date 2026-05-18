## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to
      `tests/integration/webhook-delivery-worker.test.mjs` that
      invokes the worker against a subscription whose
      `secretRows = []`; assert the worker does not throw and the
      delivery row transitions to `permanently_failed` with
      `error_detail = 'no_signing_secret_available'`.
- [ ] 1.2 [test] Add a case that invokes
      `actions/webhook-retry-scheduler.main` against a delivery whose
      subscription is `status: 'disabled'`; assert the return is
      `{status: 'cancelled'}` and the delivery row reaches
      `'cancelled'`.
- [ ] 1.3 [test] Add a case that sets
      `WEBHOOK_AUTO_DISABLE_THRESHOLD = 99` and
      `subscription.max_consecutive_failures = 3`; after the third
      consecutive failure, assert the subscription transitions to
      `'disabled'` — the per-subscription column wins.
- [ ] 1.4 [test] Add a case that runs the worker against a flapping
      subscription (`consecutive_failures = 3` then a successful
      delivery); assert the post-success row has
      `consecutive_failures = 0`.

## 2. Implementation

- [ ] 2.1 [fix] Add a guard at
      `services/webhook-engine/actions/webhook-delivery-worker.mjs:11-27`:
      if `secretRows.length === 0`, mark delivery
      `permanently_failed` with `error_detail =
      'no_signing_secret_available'`, emit
      `…delivery.permanently_failed`, return without throwing.
- [ ] 2.2 [fix] Extend the cancellation list at
      `services/webhook-engine/actions/webhook-retry-scheduler.mjs:10`
      from `['deleted', 'paused']` to `['deleted', 'paused',
      'disabled']`; on cancellation, set delivery `status =
      'cancelled'` and emit no `…delivery.succeeded`.
- [ ] 2.3 [fix] At
      `services/webhook-engine/actions/webhook-retry-scheduler.mjs:22`,
      compute the effective threshold as
      `subscription.max_consecutive_failures ??
      env.WEBHOOK_AUTO_DISABLE_THRESHOLD ?? 5`; document precedence.
- [ ] 2.4 [fix] In the worker's success path at
      `services/webhook-engine/actions/webhook-delivery-worker.mjs:37`,
      call `db.resetSubscriptionFailures(subscription.id, {
      ifConsecutiveFailures: subscription.consecutive_failures })`
      (CAS) so concurrent failure increments do not lose to the
      reset.
- [ ] 2.5 [impl] Document and assert in
      `services/webhook-engine/README.md` that
      `db.incrementSubscriptionFailures(id)` MUST be a single
      atomic SQL `UPDATE … SET consecutive_failures =
      consecutive_failures + 1 WHERE id = $1 RETURNING
      consecutive_failures`.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:integration --
      webhook-delivery-worker webhook-retry-scheduler` and
      `openspec validate fix-f3-delivery-worker-and-scheduler
      --strict`; both green before merge.
