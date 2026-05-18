## Why

The realtime-gateway library ships unit tests for `audit-publisher`,
`filter-parser`, `filter-evaluator`, `scope-checker`, `token-validator`, and
`tenant-workspace-guard`, but the most complex module — the session manager —
has no dedicated unit test file. The polling cycle, shutdown semantics, and
SUSPENDED→RESUMED flow are exercised nowhere. From
`openspec/audit/cap-b2-realtime-auth-scope-validation.md`:

- **G20** — no `session-manager.test.mjs` is present under
  `tests/unit/realtime-gateway/`. Integration tests
  `subscription-auth-flow.test.mjs` and `event-filter-enforcement.test.mjs`
  exist but do not exercise (a) the SUSPENDED-then-RESUMED flow via
  `refreshToken`, (b) timer leaks, (c) introspection-fallback after JWKS
  refresh. The session manager is approximately 250 LOC of side-effecting,
  timer-driven code at `services/realtime-gateway/src/auth/session-manager.mjs`
  and is the single highest-impact module by complexity-without-coverage in
  the package.

This is a `coverage-*` proposal: only test work, no production-code change.
The bugs that tests will eventually find are tracked under the parallel
`fix-b2-*` and `harden-b2-*` proposals; this proposal establishes the test
scaffolding and the contracts those proposals' tests can extend.

## What Changes

- Add `services/realtime-gateway/test/unit/session-manager.test.mjs` covering
  the session-manager state machine: createSession success/denial, the
  polling cycle (expiry, scope revocation, introspection failure),
  suspendSession idempotence, refreshToken, closeSession, and shutdown.
- Add fake-timer helpers and dependency-injection fixtures
  (`test/fixtures/session-manager-deps.mjs`) reusable by the parallel `fix-*`
  / `harden-*` proposals.
- Wire the new test file into `services/realtime-gateway/package.json` test
  script and into the repo-level CI coverage report.

## Capabilities

### Modified Capabilities

- `identity-and-access`: explicit unit-test coverage contract for the
  session-manager state machine.

## Impact

- Affected code:
  `services/realtime-gateway/test/unit/session-manager.test.mjs` (new),
  `services/realtime-gateway/test/fixtures/session-manager-deps.mjs` (new),
  `services/realtime-gateway/package.json` (test script update).
- Migrations: none.
- Breaking changes: none.
- Out of scope: any production-code change. Production bugs surfaced by
  the new tests are addressed under `fix-b2-audit-emission-asymmetry`,
  `fix-b2-session-lifecycle-leaks`, `harden-b2-token-and-scope-validation`,
  and `harden-b2-schema-integrity`.
