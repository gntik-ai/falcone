---
description: Generate/update the FULL Playwright E2E suite from the use cases (covering all functionalities) plus the real-stack bootstrap.
argument-hint: "[capability to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Build the real-stack E2E suite. Inputs: `audit/use-cases.md` and `audit/functionalities.md` (run `/use-cases` first if missing). Focus: $ARGUMENTS.

1. Specialize `tests/e2e/stack.sh` for this codebase (install deps, migrate/seed, start backend + frontend, health waits, print `E2E_BASE_URL`) — reading build/config files only, never docs.
2. Ensure Playwright is set up: `npm i -D @playwright/test && npx playwright install --with-deps`; tune `tests/e2e/playwright.config.ts` (baseURL, projects).
3. For each use case `uc-…`, write `tests/e2e/specs/<capability>/<uc-id>.spec.ts` driving the real UI/API through the main, alternative, and exception flows. Seed fixtures including two tenants (A/B); add cross-tenant isolation probes for tenancy-sensitive functionalities.
4. Coverage: every `fn-…` exercised by ≥1 spec; list any uncovered functionality.

Prefer delegating to the `e2e-test-author` subagent. Output: specs created/updated, the fn-coverage summary, and the run instruction (`bash tests/e2e/run.sh` or `/run-e2e`).
