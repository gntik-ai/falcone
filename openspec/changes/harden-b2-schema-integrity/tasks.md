## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add
      `services/realtime-gateway/test/integration/auth-record-columns.test.mjs`
      that inserts a SUSPENDED record and asserts `suspension_reason` carries
      the reason and `denial_reason` is NULL, proving B8/G12 from
      `auth-record-repository.mjs:34` vs migration 002.
- [ ] 1.2 [test] Add
      `services/realtime-gateway/test/integration/session-jti-unique.test.mjs`
      that inserts two ACTIVE rows for the same `token_jti` and asserts the
      second insert is rejected, proving B14/G13 from migration 003.
- [ ] 1.3 [test] Add a case that EXPLAINs the quota query at
      `validate-subscription-auth.mjs:8-20` and asserts the planner uses the
      new `(tenant_id, workspace_id, actor_identity)` index, proving G14.

## 2. Implementation

- [ ] 2.1 [migration] Add
      `services/realtime-gateway/migrations/004-add-suspension-reason.sql`
      that adds the `suspension_reason TEXT` column and backfills from
      `denial_reason` where `action = 'SUSPENDED'`.
- [ ] 2.2 [migration] Add
      `services/realtime-gateway/migrations/005-add-token-jti-unique.sql`
      that de-duplicates existing rows (keep most-recent ACTIVE per jti,
      CLOSE the rest) and adds the UNIQUE constraint.
- [ ] 2.3 [migration] Add
      `services/realtime-gateway/migrations/006-add-quota-index.sql` adding
      `CREATE INDEX … ON realtime_sessions(tenant_id, workspace_id,
      actor_identity)`.
- [ ] 2.4 [fix] Update `auth-record-repository.mjs:34` to write
      `denial_reason` and `suspension_reason` to their own columns; reject
      envelopes that supply both.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the schema-integrity invariants and the migration
      order in `services/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-b2-schema-integrity --strict`; both green.
