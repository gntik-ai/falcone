# Implementation and validation

## Amended-spec review

- [x] Verify the assigned clean worktree and branch `agent/falcone/1492/9dc174d3-03d0-5461-bc82-a7c5ed99f3ef` at supplied HEAD `65d65688f698e7c1f8c87b317d21b20b02b88615`, retaining immutable base `8bd1bc8a1db3a04652fe0acbd6044e073cdff06b`.
- [x] Review the existing ChangeSet commits against the regenerated OpenSpec. Retain the platform-only verifier marker, path workspace owner substitution, ownership result reuse, authorization gates, three flows request options and localized 401 states.
- [x] Confirm the actor mapping and claim precedence match `apps/control-plane/server.mjs` exactly. The verifier sets platform authority only after issuer, signature, time, audience and revocation checks.
- [x] Reproduce the platform-superadmin/no-tenant flows 401 twice at the base snapshot with the signed regression test, then verify it passes at HEAD.
- [x] Revalidate tenant issuer isolation, credential binding, hosted MCP scope, legacy/no-role/no-resolver/no-path rejection, invalid JWTs, API keys, gateway headers and structural write role gates.
- [x] Revalidate list/create/run-now repeated-401 retention and existing rejected-refresh redirects through the routed page seam.
- [x] Complete the inventory of indirect session-ending callers in proposal.md, including shared quota, consumption and shell context clients. No shared client or quotas code/test changes are needed.
- [x] Preserve all existing commits, including Hermes workflow pins. No deployment, gateway, Keycloak, dependency or toolchain changes are made.

This continuation changes documentation only. The retained source implementation already satisfies the amended acceptance criteria. Earlier attempt results in the preceding commits are superseded by the evidence below.

## Red/green evidence

The reproduction command and public seam are recorded in proposal.md. In an isolated archive of base `8bd1bc8a1db3a04652fe0acbd6044e073cdff06b`, the copied regression test twice expected 200 and received `401 UNAUTHENTICATED: Missing tenant identity`. At HEAD the same signed-token scenario returns only the path workspace's flows using its owning tenant. The cause remains the missing tenant identity on verified platform sessions; the console's missing suppression turned the endpoint 401 into session termination. Red runs are diagnostic evidence only.

The earlier commits also recorded red console tests before suppression and localized-error fixes. The final routed-page tests cover exactly one refresh and one replay, no session-ending handler call, the retained flows route/session and the localized `errors.401` state. Rejected refresh still has no replay and redirects with flows intent.

## Final bounded validation

All console commands below use normal mode with `SHELL_TEST_FIXTURES` unset. Vitest runs from `apps/web-console-next` using the installed runner, worker threads and Vite's runner config loader; no dependency or toolchain was changed.

- PASS: `node --test --experimental-test-isolation=none tests/unit/executor-platform-caller-identity.test.mjs tests/blackbox/executor-platform-caller-identity.test.mjs` (46 tests).
- PASS: `node --test --experimental-test-isolation=none tests/unit/executor-identity-guard.test.mjs tests/unit/executor-workspace-binding.test.mjs tests/unit/executor-mcp-workspace-binding.test.mjs tests/unit/executor-service-account-binding.test.mjs tests/unit/tenant-data-api-audience.test.mjs tests/blackbox/tenant-realm-token-issuance.test.mjs tests/unit/control-plane-jwt-verify.test.mjs tests/unit/flow-write-role-gate.test.mjs tests/unit/workspace-sa-rollback-auth.test.mjs` (652 tests).
- PASS: `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run tests/consoleFlows-routing.test.tsx tests/consoleFlows.test.tsx --pool=threads --maxWorkers=1 --configLoader=runner` (56 tests).
- PASS: `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner` (1188 passed, 3 skipped; 61 files passed, 1 skipped; 535.77 seconds).
- PASS: `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run --exclude tests/consoleQuotas-routing.test.tsx --pool=threads --maxWorkers=1 --configLoader=runner` (1179 passed, 3 skipped; 60 files passed, 1 skipped; 592.74 seconds).
- PASS: `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run tests/consoleQuotas-routing.test.tsx --pool=threads --maxWorkers=1 --configLoader=runner` (9 tests at HEAD and separately 9 at the archived base). The quotas routing file is byte-identical at base and HEAD. The prior quotas assertion failures did not recur, including in the full HEAD suite; no pre-existing assertion failure or quotas skip is claimed.
- PASS: `node apps/web-console-next/tests/parity/scan-fixtures.mjs` and `node apps/web-console-next/tests/parity/validate.mjs`.
- PASS: `node apps/web-console-next/node_modules/typescript/bin/tsc --noEmit -p apps/web-console-next/tsconfig.json`.
- PASS: JavaScript syntax checks for the verifier, server and signed-token tests; scoped OpenSpec Markdown lint; `git diff --check`.

## Sandbox limits and independent review

- SKIPPED: `pnpm --filter @in-falcone/web-console-next test` cannot start because `/usr/local/bin/node --version` returns `spawnSync EPERM`. The direct full Vitest command above passed; the pnpm command itself is not reported as passing.
- SKIPPED: unchanged blackbox suites `executor-apikey-cross-tenant-idor`, `executor-credential-workspace-binding`, `executor-ddl-db-ownership-guard` and `structural-write-role-gates-executor` encounter `listen EPERM: operation not permitted 127.0.0.1` during setup. PR CI must run them with sockets available. The signed regression instead uses the existing in-memory HTTP parser helper.
- SKIPPED: browser parity, axe and viewport runs: Chromium unavailable; PR CI runs them. Screenshot assessment remains with the independent checker and operator.

A supplementary full-suite run from the archived base had 1183 passing tests, 3 skips and 2 legacy-client import setup failures: the archive lacked the legacy app's link to its installed dependencies. After linking those existing dependencies, a scoped rerun of `tests/consoleFlows.test.tsx` and `tests/consoleFlowHistory.test.tsx` passed all 69 tests at base. No manifest or toolchain changed. These baseline diagnostics are not final-commit test results or evidence of a pre-existing assertion failure. The scoped base quotas comparison and signed executor reproduction also ran through their intended seams.

The independent checker should confirm the supplied R1 classification against the shared-gate concern. Confirmation that the platform realm's `actor_type` claim is operator-controlled requires a realm export that was not supplied. The maker did not access credentials, modify deployment state or perform staging verification. Rollout and real-session staging verification remain operator-owned.
