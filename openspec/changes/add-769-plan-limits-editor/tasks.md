## 1. Confirm Scope

- [x] T01: Read issue #769 and confirm the current baseline.
  - Acceptance: the route-level console `errorElement` is present and covered; the
    remaining gap is the plan detail Limits editor.
  - Actual paths reviewed: `apps/web-console/src/router.tsx`,
    `apps/web-console/src/components/RouteErrorBoundary.tsx`,
    `apps/web-console/src/components/console/PlanLimitsTable.tsx`,
    `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`.

## 2. Implement the Limits Editor

- [x] T02: Replace blur-save editing with explicit per-row Save.
  - Acceptance: a changed input shows a draft state, blur does not call the API, and
    Save/Enter commits only a valid changed integer value.
  - Actual paths changed: `apps/web-console/src/components/console/PlanLimitsTable.tsx`.
- [x] T03: Add per-row status and local integer guard.
  - Acceptance: rows show persisted/unsaved/saving/saved/failed state; decimal, empty,
    non-finite, and `< -1` drafts cannot be saved and do not call `setPlanLimit`.
  - Actual paths changed: `apps/web-console/src/components/console/PlanLimitsTable.tsx`,
    `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`.
- [x] T04: Confirm destructive Reset and show live-plan impact.
  - Acceptance: Reset opens the shared destructive confirmation dialog before
    `removePlanLimit`; an active assigned plan warning names the affected tenant count;
    the row displays the persisted default/effective value returned by the API.
  - Actual paths changed: `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`.

## 3. Encode the Scenario in Tests

- [x] T05: Update focused component and page tests.
  - Acceptance: tests cover decimal rejected/no API call, explicit Save required, Reset
    confirmation before DELETE, active assigned plan warning, and persisted-row
    reconciliation after Save/Reset. Existing route-boundary tests continue to cover
    shell-contained render errors.
  - Actual paths changed: `apps/web-console/src/components/console/PlanLimitsTable.test.tsx`,
    `apps/web-console/src/pages/ConsolePlanDetailPage.test.tsx`.

## 4. Documentation and OpenSpec

- [x] T06: Materialize the OpenSpec delta and update human docs.
  - Acceptance: `openspec/changes/add-769-plan-limits-editor/` contains proposal,
    tasks, and a `web-console` spec delta; the plan-limit edit reference documents the
    explicit editor, integer guard, row status, reset confirmation, and active-plan
    impact.
  - Actual paths changed: `openspec/changes/add-769-plan-limits-editor/proposal.md`,
    `openspec/changes/add-769-plan-limits-editor/tasks.md`,
    `openspec/changes/add-769-plan-limits-editor/specs/web-console/spec.md`,
    `docs/reference/architecture/console-plan-limit-edit-feedback.md`.

## 5. Verify

- [x] T07: Run focused verification.
  - Acceptance: focused web-console tests pass and `openspec validate
    add-769-plan-limits-editor --strict` passes.
  - Test target: `pnpm --dir apps/web-console exec vitest run
    src/components/console/PlanLimitsTable.test.tsx
    src/pages/ConsolePlanDetailPage.test.tsx
    src/components/RouteErrorBoundary.test.tsx` and `openspec validate
    add-769-plan-limits-editor --strict`.
  - Note: `pnpm --dir apps/web-console run typecheck` still fails on existing unrelated
    baseline errors outside this change; none reference the touched implementation or
    test files.
