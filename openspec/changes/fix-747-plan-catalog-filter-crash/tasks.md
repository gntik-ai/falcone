## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `10c47a9a`):
  `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx:21` — `e.currentTarget.value` is read inside
  the functional `setState` updater; react-dom 18's `executeDispatch` nulls `currentTarget` after the
  synchronous handler returns, so the updater throws `TypeError: Cannot read properties of null
  (reading 'value')`.
- [x] 1.2 Add regression test to
  `apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx`:
  - Render the page with `listPlans` mocked to return one plan.
  - Wait for initial rows to appear (confirms initial render succeeds).
  - Fire `fireEvent.change` on the `aria-label="status-filter"` `<select>` with value `'draft'`.
  - Assert `listPlans` is re-called with `status: 'draft'` (confirms re-query and no crash).
  - On buggy code: updater throws in the render phase → React error propagation → test failure (RED).
  - On fixed code: value captured before updater → no throw → listPlans re-invoked (GREEN).

## 2. Fix (minimal, single-line)

- [x] 2.1 In `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx`, change the `onChange` handler
  of the `<select aria-label="status-filter">` to capture `e.currentTarget.value` synchronously before
  calling `setState`:
  ```jsx
  onChange={(e) => { const status = e.currentTarget.value as api.PlanStatus | 'all'; setState((current) => ({ ...current, status, page: 1 })) }}
  ```
  Everything else on the line is unchanged.
- [x] 2.2 Do NOT touch any other handler in the file or any other file in this PR.

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — this is a pure frontend fix with no API surface change.
  Confirm no `*.openapi.json`, generated types, or `internal-contracts` are edited.
- [x] 3.2 No doc page added — this is a crash fix with no new user-facing feature; there is no
  existing web-console coding-guideline doc in the repo to update.
- [x] 3.3 Spec delta: `openspec/changes/fix-747-plan-catalog-filter-crash/specs/web-console/spec.md`
  — `## ADDED Requirements` (NOT MODIFIED) under the `web-console` capability, one new requirement
  ("Console form controls read DOM event values synchronously before any deferred updater") with a
  WHEN/THEN scenario matching the acceptance criteria.

## 4. Verify

- [ ] 4.1 CI runs `pnpm --filter @in-falcone/web-console test` (the `web-console` CI job executes
  vitest) — the new test is the executed regression gate. Local vitest execution is gated in this
  environment; CI is the authoritative check.
- [ ] 4.2 Confirm `git diff origin/main...HEAD` touches only:
  `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx`,
  `apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx`, and the three
  `openspec/changes/fix-747-plan-catalog-filter-crash/` files (force-added past `.gitignore`).
- [ ] 4.3 `openspec validate fix-747-plan-catalog-filter-crash --strict` (if the CLI is available).
