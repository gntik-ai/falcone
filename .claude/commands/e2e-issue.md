---
description: REAL end-to-end verification of ONE issue/change - install + boot the actual backend and frontend and exercise the issue's scenarios. Optional per issue.
argument-hint: "<change-id> [--keep-up]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Verify change $1 against the REAL running system (front + back).

1. Read the change (`openspec show $1`) and its acceptance scenarios; use the linked use case(s) from `audit/use-cases.md` if present.
2. Boot the real stack: `bash tests/e2e/stack.sh up` (installs dependencies, migrates/seeds, starts backend + frontend). If it is still the placeholder, specialize it first — delegate to `e2e-test-author`.
3. Write or update `tests/e2e/specs/issues/$1.spec.ts` (Playwright) exercising each scenario through the real UI and/or public API as a user would. If the change touches tenant-scoped data, include a cross-tenant probe (tenant A must not reach tenant B's data).
4. Run it: `cd tests/e2e && npx playwright test specs/issues/$1.spec.ts`.
5. Report pass/fail per scenario (expected vs actual) with trace/screenshot paths on failure. Tear down with `bash tests/e2e/stack.sh down` unless `--keep-up` was passed (then print E2E_BASE_URL for manual poking).

Keep the spec committed as a regression test. Prefer delegating spec-writing to `e2e-test-author` and the run/report to `e2e-runner`.
