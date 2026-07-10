## 1. Confirm Scope

- [x] T01: Confirm baseline issue signatures and scope.
  - Acceptance: `ConsolePlanCatalogPage.tsx` still uses a hand-rolled table, `ConsolePlanDetailPage.tsx`
    still hand-rolls tabs, and `WizardStepIndicator.tsx` styles completed/current steps identically.
  - Actual paths reviewed: `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx`,
    `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`,
    `apps/web-console/src/components/console/wizards/WizardStepIndicator.tsx`.

## 2. Implement the Design-System Adoption

- [x] T02: Migrate the plan catalog to the shared `Table` primitive.
  - Acceptance: `/console/plans` renders the catalog with `Table`, `TableHeader`, `TableBody`,
    `TableRow`, `TableHead`, and `TableCell`; row navigation and filter behavior are unchanged.
  - Actual paths changed: `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx`.
- [x] T03: Migrate the plan-detail tab strip and panels to the shared `Tabs` primitive.
  - Acceptance: `/console/plans/:planId` renders `TabsList`, `TabsTrigger`, and `TabsContent`, and
    the active tab has the shared active state while inactive tabs are marked inactive.
  - Actual paths changed: `apps/web-console/src/pages/ConsolePlanDetailPage.tsx`.
- [x] T04: Distinguish tenant-wizard progress states.
  - Acceptance: current, completed, and upcoming wizard steps render with separate states and only
    the current step exposes `aria-current="step"`.
  - Actual paths changed: `apps/web-console/src/components/console/wizards/WizardStepIndicator.tsx`.

## 3. Encode the Scenario in Tests

- [x] T05: Add focused tests for the issue #751 Plans and wizard scenario.
  - Acceptance: tests assert the plan catalog uses shared `Table` hooks and row affordance, plan
    detail uses shared `Tabs` active/inactive state, tenant wizard progress states are distinct, and
    plan status badges keep the theme-aware translucent tone idiom.
  - Actual paths changed: `apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx`,
    `apps/web-console/src/pages/ConsolePlanDetailPage.test.tsx`,
    `apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx`,
    `apps/web-console/src/components/console/PlanStatusBadge.test.tsx`.

## 4. Documentation and OpenSpec

- [x] T06: Materialize the OpenSpec delta and update human docs.
  - Acceptance: `openspec/changes/add-console-plans-design-system/` contains proposal, tasks, and
    spec delta artifacts; the console design-system reference no longer lists Plans as out of scope.
  - Actual paths changed: `openspec/changes/add-console-plans-design-system/proposal.md`,
    `openspec/changes/add-console-plans-design-system/tasks.md`,
    `openspec/changes/add-console-plans-design-system/specs/web-console/spec.md`,
    `docs/reference/architecture/console-design-system-primitives.md`.

## 5. Verify

- [x] T07: Run focused verification.
  - Acceptance: focused web-console tests pass and `openspec validate add-console-plans-design-system
    --strict` passes.
  - Test target: `pnpm --dir apps/web-console exec vitest run
    src/pages/ConsolePlanCatalogPage.test.tsx src/pages/ConsolePlanDetailPage.test.tsx
    src/components/console/wizards/CreateTenantWizard.test.tsx
    src/components/console/PlanStatusBadge.test.tsx` and
    `openspec validate add-console-plans-design-system --strict`.
