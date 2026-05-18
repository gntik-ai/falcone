## Why

`services/provisioning-orchestrator/` carries 62 `*.test.mjs` files under `src/tests/` and `tests/`, but `package.json:7-9` ships placeholder lint/test/typecheck scripts so none of them are executed by `pnpm test`. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **G16** — "62 `.test.mjs` files under `src/tests/` and `tests/` exist but are not wired to `pnpm test`. Coverage is not run as part of the validated build."

This means every fix proposal in C1 lands without the existing tests verifying it; regressions can ship without flagging. The `complete-c1-control-plane-bootstrap` proposal wires the test runner, but the existing tests will reveal failures that need triage and repair. This proposal is the test-content workstream: triage every existing test, repair the ones that fail because of stale assertions, and add explicit fixtures so the suite is runnable without an external Postgres/Kafka.

## What Changes

- Triage all 62 test files into `passing`, `failing-assertion-drift`, `failing-environment` (needs Postgres/Kafka), and `unsalvageable` buckets.
- Repair the `failing-assertion-drift` bucket so assertions match current handler behaviour.
- Wrap the `failing-environment` bucket with the existing `pg-mem` and `kafkajs` in-memory test doubles already present in `apps/control-plane/src/tests/`; copy or reuse the fixture helpers.
- Delete unsalvageable tests with a one-line PR-description rationale per file.
- After the suite is green, raise CI coverage threshold for the package to a baseline floor (no specific number — measure first, then lock).

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: turns the inert orchestrator test suite into an enforcing CI gate.

## Impact

- Affected code: every file under `services/provisioning-orchestrator/src/tests/` and `services/provisioning-orchestrator/tests/`; new helpers under `services/provisioning-orchestrator/src/tests/__helpers/`.
- Migrations: no schema change.
- Breaking changes: none — pure test work.
- Out of scope: writing new tests for uncovered behaviour (each fix proposal in C1 owns its own test additions); modifying `package.json` to wire the test runner (covered by `complete-c1-control-plane-bootstrap`).
