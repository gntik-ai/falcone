# Implementation and validation

- [x] Verify the assigned worktree and branch; retain the R1 source-only boundary.
- [x] Reproduce the legacy policy/form ordering failure at the rendered page seam before replacing the synchronous query.
- [x] Preserve the original assertions in each of the six tests and wait for its relevant async state.
- [x] Confirm the pinned toast honors reduced motion; make no signup page change.
- [x] Reproduce the allocation ordering race twice at the rendered control seam before adding the in-flight focus guard; retain its deterministic regression.
- [x] Temporarily replace the catch-all Suspense fallback with null and confirm the updated pending-skeleton test fails on the loading ID. Restore router.tsx byte-for-byte afterward.
- [x] Run the affected unit-test files in 30 fresh processes each.
- [x] Run the normal next-console and legacy unit suites.
- [x] Run parity fixture scan and manifest validation.
- [x] Check syntax, scoped Markdown and the final diff.
- [x] Commit the bounded change locally without publishing.

## Sandbox constraints

The pnpm launcher cannot spawn `/usr/local/bin/node --version` (`spawnSync EPERM`). Direct Node invocation of the installed Vitest runner works with `--pool=threads --configLoader=runner`. No toolchain or configuration is changed. Installed Vitest 4.1.0 rejects the requested `--repeat=30` option as unknown; use 30 independent invocations of each affected file set instead, failing the loop on its first failure.

Browser parity, axe and viewport runs: **SKIPPED — Chromium unavailable; PR CI runs them.** Browser stress and the temporary longer-toast-transition negative check have the same limit. Run the existing three specs with:

```sh
pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/parity/playwright.config.mjs tests/parity/pages/console-operations.spec.mjs tests/parity/pages/console-quotas-page.spec.mjs tests/parity/pages/signup-page.spec.mjs --repeat-each=30 --grep 'unmount cancels debounce|console-quotas-page.*error-empty|signup-page.*accessibility'
```

This retains the specs' role, locale and viewport matrices, including workspace_viewer/es/375 operations and superadmin/es/375 quotas. Re-run the same selection under CPU throttling where available. The only page change is the allocation focus guard; no markup, styling or visual baseline changes are made.

## Final validation evidence

All unit runs use normal mode, with no fixture-mode full suite. Direct runner invocations are the sandbox workaround for pnpm's EPERM, not changes to repository test settings.

- PASS: from `apps/web-console-next`, run `node node_modules/vitest/vitest.mjs run tests/notFound.test.tsx tests/consoleTenantAllocationSummary.test.tsx --pool=threads --configLoader=runner` in 30 fresh processes, stopping on the first failure: 30/30 runs, 1440 passing test executions (48 tests per run), including both locales and the deterministic allocation regression.
- PASS: from `apps/web-console-next`, `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner`: 65 files passed, one skipped; 1232 tests passed, three skipped.
- PASS: from `apps/web-console`, run `node node_modules/vitest/vitest.mjs run src/pages/SignupPage.test.tsx --pool=threads --configLoader=runner` in 30 fresh processes, stopping on the first failure: 30/30 runs, 360 passing test executions (12 tests per run).
- PASS: from `apps/web-console`, `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner`: 195 files, 1400 tests passed.
- PASS: `node apps/web-console-next/node_modules/typescript/bin/tsc --noEmit -p apps/web-console-next/tsconfig.json`.
- PASS: `node apps/web-console-next/tests/parity/scan-fixtures.mjs` and `node apps/web-console-next/tests/parity/validate.mjs`.
- PASS: JavaScript syntax checks for the three parity specs, scoped OpenSpec Markdown lint and `git diff --check`. The source diff adds no wall-clock sleep or test timing, retry or worker settings. Workflows and lockfiles are unchanged.
- SKIPPED: `pnpm --filter @in-falcone/web-console-next test` and `pnpm --filter @in-falcone/web-console test`: `spawnSync /usr/local/bin/node EPERM` during launcher startup. Direct full-suite results are reported separately.
- SKIPPED: the requested Vitest repetition option, because installed Vitest 4.1.0 reports `Unknown option --repeat`. Fresh-process repetition is used instead.
- SKIPPED: browser repetitions, browser stress, axe, viewport and the longer-toast-transition negative check: Chromium unavailable; PR CI runs them.

The pre-fix allocation failures, catch-all heading focus failure and deliberately removed-skeleton negative failure are red-before-green diagnostics, not final test results. Superseded full-suite runs were cancelled after changing the affected source or tests; only validation of the final implementation is reported above.

## Checker follow-up

- [x] Remove the added quotas-surface wait from the shared open helper, restoring that helper to the immutable base. The 401 case must reach login without requiring a quotas surface after navigation.
- [x] Retain the declared state locators, organization-table wait, error request-ID wait, recovered two-table count, login URL and exact refresh-traffic assertions. No additional page change is needed.
- [x] Update the proposal and quotas scenario to describe the per-state waits and the login redirect.
- [x] Re-run parity fixture scan, manifest validation, quotas-spec syntax, scoped Markdown lint and the diff check; all pass. Verify that the shared helper matches the base and that the source/test additions contain no sleeps or timing, retry or worker configuration changes.
- PASS: from `apps/web-console-next`, `node node_modules/vitest/vitest.mjs run tests/notFound.test.tsx tests/consoleTenantAllocationSummary.test.tsx --pool=threads --configLoader=runner --maxWorkers=1`: 48/48 tests.
- PASS: from `apps/web-console-next`, `env -u SHELL_TEST_FIXTURES node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner`: 65 files passed, one skipped; 1232 tests passed, three skipped.
- PASS: from `apps/web-console`, `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --configLoader=runner`: 195 files, 1400/1400 tests.
- SKIPPED: both pnpm full-suite commands still encounter `spawnSync /usr/local/bin/node EPERM`; direct runner results are recorded separately.
- SKIPPED: the quotas error-empty browser regression, all three parity specs with `--repeat-each=30`, browser stress, axe, viewport, detail-mount negative and longer-toast-transition negative checks: Chromium unavailable; PR CI runs them. No fresh browser reproduction or browser success is claimed.
- The preceding maker's 30 fresh-process unit repetitions remain prior-attempt evidence; the checker follow-up changes only the quotas spec and OpenSpec documentation.
