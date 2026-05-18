## 1. Failing tests proving the gap

- [ ] 1.1 [test] Add `tests/integration/d1/harness.mjs` that spins up
      a PostgreSQL container (testcontainers or docker-compose), exposes
      a `runPlan(plan)` helper that executes the adapter's emitted
      plans under a real connection, and tears down between cases.
- [ ] 1.2 [test] Add `tests/integration/d1/transactional-ddl.test.mjs`
      that runs a `transactional_ddl` plan with a forced failure on
      statement 2; assert statement 1 is rolled back. This test MUST
      fail today against the unwrapped statement loop highlighted by
      G-cross.3 / B-cross.1.
- [ ] 1.3 [test] Add `tests/integration/d1/rls-bind-values.test.mjs`
      that runs a list-with-RLS plan with `sessionContext: {}` and
      asserts the executor refuses to bind `undefined` (validating the
      B-S3.1 condition end-to-end, complementing the compilation test
      in `fix-d1-rls-session-context`).

## 2. Implementation

- [ ] 2.1 [impl] Wire the new harness into `package.json` as a
      `test:integration:d1` script and into the CI workflow so the
      execution-time suite runs on every PR touching
      `services/adapters/src/postgresql-*.mjs`.
- [ ] 2.2 [impl] Add a README at `tests/integration/d1/README.md`
      describing how to run the harness locally and the categories
      of execution-time concerns it covers.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the execution-time coverage policy and the
      relationship to sibling compilation-only tests in
      `services/adapters/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate coverage-d1-execution-tests --strict`; both
      green before merge.
