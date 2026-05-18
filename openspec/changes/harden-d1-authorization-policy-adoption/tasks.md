## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-executor-transactionality.test.mjs`
      that runs a plan marked `transactionMode: 'transactional_ddl'`
      (`services/adapters/src/postgresql-admin.mjs:1790`) through the
      executor with a forced failure on statement 2 of 3; assert
      statement 1's effects are rolled back (proves B-cross.1 / G-cross.1).
- [ ] 1.2 [test] Add a test that greps each PostgreSQL adapter for an
      `authorization-policy.mjs` import and asserts every adapter
      imports it; today no adapter does (proves B-cross.2 / G-cross.2).
- [ ] 1.3 [test] Add a test that submits an operation against a surface
      absent from `adapterEnforcementSurfaces`; assert the adapter
      rejects with an unsupported-surface error.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/adapters/src/postgresql-executor.mjs`
      that consumes the plan returned by
      `build*PostgresAdapterCall` and runs the statements under
      `BEGIN; … COMMIT;` when
      `transactionMode === 'transactional_ddl'`, calling `ROLLBACK`
      on any statement failure.
- [ ] 2.2 [impl] Add `import` of
      `services/adapters/src/authorization-policy.mjs` to each of
      `postgresql-admin.mjs`, `postgresql-structural-admin.mjs`,
      `postgresql-data-api.mjs`, `postgresql-governance-admin.mjs`;
      consume `adapterEnforcementSurfaces` and
      `workspaceOwnedResourceSemantics` at the authorisation entry
      points.
- [ ] 2.3 [fix] Reject any operation in each adapter whose
      `originSurface` is absent from `adapterEnforcementSurfaces`
      with an unsupported-surface error.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the transaction executor and the shared
      `authorization-policy.mjs` adoption in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-d1-authorization-policy-adoption --strict`;
      both green before merge.
