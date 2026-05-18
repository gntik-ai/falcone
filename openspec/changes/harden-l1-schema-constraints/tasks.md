## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/confirmations/confirmations.repository.test.ts`
      asserting `restore_confirmation_requests` has a primary key
      (via `pg_constraint` query); assert PK is non-null after the
      migration is applied.
- [ ] 1.2 [test] Add a case that attempts a direct DB INSERT with
      `prechecks_result = '"not-an-object"'::jsonb`; assert the
      CHECK rejects it.
- [ ] 1.3 [test] Add a case attempting an INSERT with
      `expires_at = created_at`; assert the CHECK rejects it.
- [ ] 1.4 [test] Add a case attempting an INSERT with
      `tenant_id = NULL`; assert the NOT NULL rejects it.

## 2. Implementation

- [ ] 2.1 [migration] Create
      `services/backup-status/migrations/006_restore_confirmations_hardening.sql`.
- [ ] 2.2 [migration] In the same migration, add `id UUID` if not
      present, backfill `id = gen_random_uuid()` for existing rows,
      then `ALTER TABLE restore_confirmation_requests ADD PRIMARY KEY
      (id)`.
- [ ] 2.3 [migration] Add
      `CHECK (jsonb_typeof(prechecks_result) = 'object' AND
      jsonb_typeof(prechecks_result->'blocking_errors') = 'array' AND
      jsonb_typeof(prechecks_result->'warnings') = 'array' AND
      jsonb_typeof(prechecks_result->'ok') = 'array')`.
- [ ] 2.4 [migration] Add `CHECK (expires_at > created_at)`.
- [ ] 2.5 [migration] Add `ALTER TABLE ... ALTER COLUMN tenant_id SET
      NOT NULL, ALTER COLUMN requested_by SET NOT NULL`.

## 3. Validation

- [ ] 3.1 [test] Re-run the L1 confirmations test suite and
      `openspec validate harden-l1-schema-constraints --strict`; both
      green.
- [ ] 3.2 [docs] Document the new constraints in
      `services/backup-status/README.md` (schema section).
