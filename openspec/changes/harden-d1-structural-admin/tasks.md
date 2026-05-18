## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-structural-admin-correctness.test.mjs`
      that creates a column of user-defined type `MyEnum`; assert the
      emitted SQL contains `"public"."MyEnum"`, not `"public".myenum`
      (proves B-S4.1 at
      `services/adapters/src/postgresql-structural-admin.mjs:603-611`).
- [ ] 1.2 [test] Add a test that issues a multi-step ALTER TABLE
      (TYPE + NOT NULL + DEFAULT) on one column; assert the emitted SQL
      is a single statement with comma-separated `ALTER COLUMN` actions
      (proves B-S4.2 at `:2017-2035`).
- [ ] 1.3 [test] Add a test that submits an FK with
      `onDelete: 'EVIL ACTION'`; assert the adapter raises a whitelist
      violation (proves B-S4.3 / G-S4.6 at `:1874-1875`).
- [ ] 1.4 [test] Add a test that creates two NOT NULL constraints whose
      pre-truncation names share the first 60 characters; assert the
      generated constraint names differ (proves B-S4.4 at `:982`).
- [ ] 1.5 [test] Add a test that creates a column named `USER`; assert
      validation rejects with a reserved-keyword error (proves G-S4.1).

## 2. Implementation

- [ ] 2.1 [fix] In
      `services/adapters/src/postgresql-structural-admin.mjs:603-611`,
      replace the `normalizeIdentifier` call for the type-name component
      with `quoteIdent`, preserving the case the caller supplied.
- [ ] 2.2 [fix] Rewrite the multi-step ALTER TABLE emitter at
      `:2017-2035` to produce one statement with comma-separated
      `ALTER COLUMN <name> TYPE …, ALTER COLUMN <name> SET NOT NULL, …`
      clauses.
- [ ] 2.3 [fix] Add a whitelist for FK `onDelete` / `onUpdate` at
      `:1874-1875`: accept only
      `NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT`.
- [ ] 2.4 [fix] At `:982`, append a short hash suffix (e.g. 8 hex
      characters of SHA-256 over the full pre-truncation name) when
      truncation would cause a collision; ensure the suffix fits in
      63 chars total.
- [ ] 2.5 [fix] Add a reserved-keyword check alongside the existing
      `pg_*` / `sql_*` prefix check; reject identifiers matching the
      SQL-99 reserved-word list.
- [ ] 2.6 [fix] Allow `CONCURRENTLY` index creation at `:1254-1255`
      as an opt-in flag and allow `SECURITY DEFINER` routine option at
      `:1434-1435, 2200` gated by `platform_operator` role.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the case-preservation, whitelist, hash-suffix,
      reserved-keyword, CONCURRENTLY, and SECURITY DEFINER contracts in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-d1-structural-admin --strict`; both
      green before merge.
