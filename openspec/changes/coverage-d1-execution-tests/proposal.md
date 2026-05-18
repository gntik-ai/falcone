## Why

The 11 existing test files for the PostgreSQL adapters under
`tests/adapters/`, `tests/unit/`, `tests/resilience/`,
`tests/contracts/`, `tests/e2e/console/` exercise the SQL-string output
and validation only; they cannot reach execution-time concerns. From
`openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **G-cross.3** — "Tests exist but cover compilation only. The 11 test
  files exercise the SQL-string output (and validation) but cannot
  reach execution-time concerns (transaction atomicity, lock
  semantics, partial-failure recovery)."

Several of the most damaging bugs in this capability (B-S3.1's silent
deny-all, B-S4.2's partial multi-step ALTER, B-cross.1's missing
transaction wrapper) are by nature execution-time conditions that the
compilation-only test suite cannot catch. This is a test-only proposal
that stands up an execution-level test harness against a real (or
test-container) PostgreSQL instance.

## What Changes

- Add an execution-level test harness under `tests/integration/d1/`
  that spins up a PostgreSQL container, runs the adapter's emitted
  plans through a real executor, and asserts on observed database
  state (not on the SQL string).
- Cover the four execution-time concerns the existing compilation
  tests cannot reach: (1) transaction atomicity of
  `transactional_ddl` plans, (2) lock-target collisions in
  governance grants, (3) partial-failure recovery in multi-step
  ALTER TABLE, (4) RLS predicate behaviour with real bind values
  (including `undefined` -> `NULL` regression for B-S3.1).
- Wire the new harness into CI so future adapter changes are
  validated against execution-time invariants, not just compilation.

## Capabilities

### Modified Capabilities

- `data-services`: execution-time test coverage for the PostgreSQL
  adapters, complementing the existing compilation-only suite.

## Impact

- Affected code: `tests/integration/d1/` (new test directory),
  `package.json` test scripts, CI workflow file.
- Migrations: none.
- Breaking changes: none — purely additive test coverage.
- Out of scope: the actual bug fixes targeted by the failing tests;
  those land in sibling proposals (`fix-d1-rls-session-context`,
  `fix-d1-governance-policy-correctness`,
  `harden-d1-data-api-quotas-and-bulk`,
  `harden-d1-structural-admin`,
  `harden-d1-effective-roles-trust`,
  `harden-d1-authorization-policy-adoption`).
