## 1. Encode the issue acceptance criteria

- [x] 1.1 Add/update focused tests for
  `ConsoleTenantAllocationSummaryPage` so loading/error/empty states still render
  the page heading and wayfinding before the state card.
  - Paths: `apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.test.tsx`.
- [x] 1.2 Add/update focused tests for `ConsolePageState` icon support and the
  allocation empty state using that icon slot.
  - Paths: `apps/web-console/src/components/console/ConsolePageState.test.tsx`,
    `apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.test.tsx`.
- [x] 1.3 Add/update focused tests for
  `WorkspaceAllocationSummaryTable` so allocation values carry units, workspace
  labels are human-readable where possible, and raw UUIDs are not primary copy.
  - Paths:
    `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.test.tsx`.
- [x] 1.4 Add/update focused tests for `ConsoleTenantPlanOverviewPage` so an
  over-limit tenant aggregate renders as destructive/alert styling, while the
  existing row-level breach behavior remains intact.
  - Paths: `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.test.tsx`.

## 2. Implement the frontend fix

- [x] 2.1 `ConsolePageState`: add a backward-compatible optional icon slot.
  - Paths: `apps/web-console/src/components/console/ConsolePageState.tsx`.
- [x] 2.2 `ConsoleTenantAllocationSummaryPage`: render the header/wayfinding
  before every page state and pass icons to loading/error/empty states.
  - Paths: `apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx`.
- [x] 2.3 `WorkspaceAllocationSummaryTable`: use the shared table primitive,
  format values with units, and render workspace labels instead of run-on raw
  identifier strings.
  - Paths:
    `apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx`,
    `apps/web-console/src/services/planManagementApi.ts`.
- [x] 2.4 `ConsoleTenantPlanOverviewPage`: change the over-limit aggregate banner
  from amber warning styling to destructive/alert styling.
  - Paths: `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx`.

## 3. Documentation and OpenSpec

- [x] 3.1 Update the local allocation-summary reference note for the console
  header-first and label/unit rendering contract.
  - Paths:
    `docs/reference/architecture/workspace-sub-quota-allocation-summary.md`.
- [x] 3.2 Add the issue #774 ADDED requirement delta under this change.
  - Paths:
    `openspec/changes/fix-774-tenant-plan-allocation-ux/proposal.md`,
    `openspec/changes/fix-774-tenant-plan-allocation-ux/specs/quotas-plans/spec.md`.

## 4. Verify

- [x] 4.1 Run the focused web-console tests covering the touched components and
  pages.
  - `pnpm --filter @in-falcone/web-console exec vitest run src/components/console/ConsolePageState.test.tsx src/pages/ConsoleTenantAllocationSummaryPage.test.tsx src/components/console/WorkspaceAllocationSummaryTable.test.tsx src/pages/ConsoleTenantPlanOverviewPage.test.tsx src/components/console/ConsumptionBar.test.tsx src/components/console/QuotaConsumptionTable.test.tsx`
    passed: 6 files / 26 tests.
  - `pnpm --filter @in-falcone/web-console typecheck` still fails on pre-existing
    unrelated diagnostics outside this change (backup scope test mock typing,
    backup detail impossible comparison, plan tests importing `afterEach` from
    Testing Library, router package mismatch, members JSON body typing, and
    secret-rotation tsconfig inclusion).
- [x] 4.2 Run `openspec validate fix-774-tenant-plan-allocation-ux --strict`.
  - Passed: `Change 'fix-774-tenant-plan-allocation-ux' is valid`.
