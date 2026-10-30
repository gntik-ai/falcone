# Implementation and validation

- [x] Verify the assigned worktree and branch at clean base `8bd1bc8a1db3a04652fe0acbd6044e073cdff06b`.
- [x] Reproduce the platform-superadmin/no-tenant flows 401 twice before changing source.
- [x] Test and implement platform-only workspace owner substitution; observe unknown-owner and resolver-error tests fail before implementing 404 behavior.
- [x] Pin the complete control-plane actor mapping and precedence through signed JWT verification.
- [x] Preserve and test tenant issuer isolation, credential binding, legacy/no-role/no-resolver/no-path rejection, invalid JWTs, structural role gates, API keys and gateway headers.
- [x] Observe list/create/run-now repeated-401 tests invoke the session-ending handler before the client fix.
- [x] Suppress domain-401 invalidation for the three flows requests only; render the existing localized list 401 message after observing its missing-message assertion fail.
- [x] Add parity cases and document the other callers and legacy session behavior in proposal.md.
- [x] Record final bounded validation and CI-only checks below.

## Bounded evidence

- PASS: `node --test --experimental-test-isolation=none tests/unit/executor-platform-caller-identity.test.mjs tests/blackbox/executor-platform-caller-identity.test.mjs` (46 tests).
- PASS: `node --test --experimental-test-isolation=none tests/unit/executor-identity-guard.test.mjs tests/unit/executor-workspace-binding.test.mjs tests/unit/executor-mcp-workspace-binding.test.mjs tests/unit/executor-service-account-binding.test.mjs tests/unit/tenant-data-api-audience.test.mjs tests/blackbox/tenant-realm-token-issuance.test.mjs` (610 tests).
- PASS: `node --test --experimental-test-isolation=none tests/unit/control-plane-jwt-verify.test.mjs tests/unit/flow-write-role-gate.test.mjs tests/unit/workspace-sa-rollback-auth.test.mjs` (42 tests).
- PASS: from `apps/web-console-next`, `node node_modules/vitest/vitest.mjs run tests/consoleFlows-routing.test.tsx tests/consoleFlows.test.tsx --pool=threads --maxWorkers=1 --configLoader=runner` (56 tests). This includes unchanged refresh-failure redirects and legacy/new client wire parity.
- PASS: `node apps/web-console-next/tests/parity/scan-fixtures.mjs`, `node apps/web-console-next/tests/parity/validate.mjs`, and `node apps/web-console-next/node_modules/typescript/bin/tsc --noEmit -p apps/web-console-next/tsconfig.json`.
- PASS: JavaScript syntax checks, OpenSpec Markdown lint and `git diff --check`. No debug instrumentation remains.
- SKIPPED: the pnpm entrypoint (`pnpm --filter @in-falcone/web-console-next test`) cannot spawn `/usr/local/bin/node --version` (`spawnSync EPERM`). The installed Vitest runner can run with worker threads and Vite's runner config loader; no dependency or toolchain change is needed.
- SKIPPED: unchanged `executor-apikey-cross-tenant-idor`, `executor-credential-workspace-binding`, `executor-ddl-db-ownership-guard` and `structural-write-role-gates-executor` blackbox suites each hit `listen EPERM: operation not permitted 127.0.0.1` during setup. Their existing assertions are unchanged; PR CI must run them with listening sockets available.
- SKIPPED: browser parity, axe and viewport runs: Chromium unavailable; PR CI runs them. Screenshot assessment remains with the checker and operator.

Node's default test subprocess isolation is unavailable in this sandbox, so passing executor commands disable that isolation while retaining the actual test runner and HTTP parser. The initial console run using a root-level `--root` invocation could not import the existing legacy-client fixture via Vite's `/@fs` URL; rerunning the scoped suite from the app directory passed all 56 tests. No failing pre-fix run is counted as final test evidence.

## Prior attempt full console suite

The normal full suite ran from `apps/web-console-next` using `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner` with `SHELL_TEST_FIXTURES` unset. Result: 1187 passed, 1 failed, 3 skipped across 62 files (571.39 seconds). The real assertion failure is in the unchanged `tests/consoleQuotas-routing.test.tsx:99`, `posture 401 refresh rejected=false preserves shell authorization behavior`: Testing Library could not find a table after the refresh. This is reported as FAIL against the configured `pnpm --filter @in-falcone/web-console-next test` command so the platform can rerun the same suite at base. Its pnpm entrypoint itself cannot execute here because of the separate `spawnSync EPERM` limit above. No base-commit result is claimed and the quotas page is outside this ChangeSet. All flows tests passed in the full run and in the separate 56-test scoped run.

PR CI and the base-commit rerun decide the unrelated full-suite failure. The own-change tests pass. The checker must also confirm the risk class and review the parity screenshots with the operator; the source maker performed no deployment, merge, push or credential access.

## Follow-up review on a63c1bee

The assigned worktree was clean on branch `agent/falcone/1492/9dc174d3-03d0-5461-bc82-a7c5ed99f3ef` at the supplied continuation HEAD `a63c1beeac2ffb25fb02e4ab21e5f29fae91e3c2`. Review retained the existing platform-only verifier marker, path workspace tenant substitution, later authorization gates and three flows request options. The Hermes workflow pins and deployment worktree were left untouched.

One remaining acceptance gap was reproduced twice at the routed page seam: run-now preferred a backend reason over `errors.401`. The existing test used an empty 401 response and could not catch this. The strengthened fixture returns the executor's `UNAUTHENTICATED` response with its `Missing tenant identity` message. From `apps/web-console-next`, `node node_modules/vitest/vitest.mjs run tests/consoleFlows-routing.test.tsx -t 'RUN repeated endpoint' --pool=threads --maxWorkers=1 --configLoader=runner` failed because the page displayed that backend reason instead of the localized 401 state. This red run is diagnostic evidence, not a final test result.

The fix gives status 401 precedence over server reasons in the flows page only, reusing both existing locale catalogs. The parity assertion now requires that same 401 state for run-now as for list and create. Refresh, replay, session retention, route retention and handler assertions remain at the real routed-page seam. Other error statuses retain their server-reason behavior.

Follow-up validation supersedes the earlier attempt's final test results. The scoped console suite passes all 56 tests, including successful-refresh repeated-401 journeys and rejected-refresh login redirects. The signed platform suites pass all 46 tests; the existing identity, workspace binding, tenant audience, tenant realm issuance, control-plane verification and role regression suites pass all 652 tests using the commands above with test isolation disabled. Parity fixture scan, parity validation, TypeScript, JavaScript syntax, Markdown lint and diff checks pass. The pnpm entrypoint still cannot spawn `/usr/local/bin/node --version` (`spawnSync EPERM`); the installed Vitest runner works with threads and the runner config loader. Each of the four unchanged socket-based blackbox suites still encounters `listen EPERM: operation not permitted 127.0.0.1` during setup and requires PR CI. Browser parity, axe and viewport checks remain skipped: Chromium unavailable; PR CI runs them. Independent screenshot assessment and risk-class review remain with the checker and operator.

The full normal console suite completed in 406.54 seconds with 1186 passed, 2 failed and 3 skipped tests across 62 files. The exact command, from `apps/web-console-next`, was `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner`. Both assertion failures are in unchanged `tests/consoleQuotas-routing.test.tsx`: the successful-refresh case cannot find a table at line 99, and the rejected-refresh case reads a null protected route intent at line 96. All flows tests pass. These are real assertion failures, reported against the command actually run; the configured pnpm entrypoint is separately reported as skipped for its EPERM failure. No baseline result is claimed. The platform base rerun and PR CI decide the unrelated quotas failures.
