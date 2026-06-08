---
description: Generate/update the FULL Playwright E2E suite from the USER STORIES (real-user flows over the BaaS, frontend-first) and wire the Helm deploy in tests/e2e/stack.sh.
argument-hint: "[capability to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Build the real-stack E2E suite. Inputs: `audit/user-stories.md` (primary), `audit/use-cases.md`, `audit/functionalities.md` (run `/user-stories` first if missing). Focus: $ARGUMENTS.

1. Wire the deploy in `tests/e2e/stack.sh` to Falcone's real **Helm chart** (set `E2E_HELM_CHART`/`E2E_HELM_VALUES` defaults if the chart is not in a standard path), the correct port-forwards (`E2E_FWD`), `E2E_BASE_URL`, and a health endpoint (`E2E_HEALTH_PATH`). `up` must gate on ALL services operational; `down` must delete the namespace so NO pods remain. The test-cluster kubeconfig `./kubeconfig-test-cluster-b.yaml` is picked up automatically. Read deploy/build files only, never docs.
2. Ensure Playwright is set up: `npm i -D @playwright/test && npx playwright install --with-deps`; tune `tests/e2e/playwright.config.ts` (keep the JSON reporter).
3. For each user story `us-…`, write `tests/e2e/specs/<capability>/<us-id>.spec.ts` replicating the REAL user flow through the frontend (UI-first; use the API request context only for setup/teardown or API-only capabilities), covering acceptance criteria plus key alternative/exception paths from the linked `uc-…`. Seed fixtures including two tenants (A/B); add cross-tenant isolation probes for tenancy-sensitive stories.
4. Coverage: every `fn-…` exercised by ≥1 spec; list any uncovered functionality.

Prefer delegating to the `e2e-test-author` subagent. Output: specs created/updated, the fn-coverage summary, and the run instruction (`/run-e2e`, which always tears down). On failures later, close the loop with `/report-e2e-failures`.
