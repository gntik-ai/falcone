## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to
      `tests/integration/webhook-signing-secrets.test.mjs` that
      inserts two `status = 'active'` rows for one
      `subscription_id`; assert the second insert fails with a
      UNIQUE violation. Today both inserts succeed.
- [ ] 1.2 [test] Add a case that hard-deletes a `webhook_subscriptions`
      row (after backfilling a synthetic one) and asserts the
      corresponding `webhook_signing_secrets` rows are removed by
      cascade. Today they survive as orphans.

## 2. Implementation

- [ ] 2.1 [migration] Add
      `services/webhook-engine/migrations/002-signing-secret-constraints.sql`
      with three statements:
      (a) backfill: `UPDATE webhook_signing_secrets SET status =
      'revoked', revoked_at = now() WHERE id NOT IN (SELECT DISTINCT
      ON (subscription_id) id FROM webhook_signing_secrets WHERE
      status = 'active' ORDER BY subscription_id, created_at DESC)`;
      (b) `CREATE UNIQUE INDEX
      webhook_signing_secrets_one_active_per_subscription ON
      webhook_signing_secrets(subscription_id) WHERE status =
      'active';`
      (c) `ALTER TABLE webhook_signing_secrets DROP CONSTRAINT
      webhook_signing_secrets_subscription_id_fkey, ADD CONSTRAINT
      webhook_signing_secrets_subscription_id_fkey FOREIGN KEY
      (subscription_id) REFERENCES webhook_subscriptions(id) ON
      DELETE CASCADE;`
- [ ] 2.2 [impl] Update the out-of-package `db.rotateSecret` to
      wrap the insert+demote in a transaction so the new UNIQUE
      index does not error on concurrent rotation; document the
      contract in `services/webhook-engine/README.md`.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:integration --
      webhook-signing-secrets` and `openspec validate
      harden-f3-schema-constraints --strict`; both green before
      merge.
