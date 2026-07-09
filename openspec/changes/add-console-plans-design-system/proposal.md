## Why

Issue #751 confirmed that the superadmin Plans surface still bypassed the console design system:
`ConsolePlanCatalogPage.tsx` rendered a hand-rolled `<table>`, `ConsolePlanDetailPage.tsx`
hand-rolled its tab strip with `Button` instances, and the tenant-creation wizard rendered
completed and current steps with the same visual treatment. The result was a visually inconsistent
superadmin flow next to the already-modernized console surfaces.

## What Changes

- `ConsolePlanCatalogPage.tsx` renders the plan catalog through the shared `Table` primitive,
  preserving row navigation while inheriting the shared padded cells, header treatment, table
  wrapper, and stable `data-slot` hooks.
- `ConsolePlanDetailPage.tsx` renders the detail tab strip and panels through the shared `Tabs`,
  `TabsList`, `TabsTrigger`, and `TabsContent` primitives, so active/inactive state and keyboard
  navigation are owned by the shared component.
- `WizardStepIndicator.tsx` distinguishes `current`, `completed`, and `upcoming` states with
  separate design-token classes and exposes the current step through `aria-current="step"`.
- Existing `PlanStatusBadge` theme-aware status tones remain the plan-status rendering contract,
  with tests pinning the translucent dark-root badge idiom.
- The console design-system reference doc is updated to include the superadmin Plans and tenant
  wizard adoption.

## Non-Goals

- No backend, OpenAPI, SDK, generated client, or wire-contract changes.
- No new Plans API behavior, lifecycle semantics, quota enforcement, tenant-assignment behavior,
  or route changes.
- No broad console restyle beyond the Plans catalog, Plans detail tabs, and tenant wizard progress
  indicator called out by the issue.

## Exit Criteria

- `/console/plans` renders a shared `Table` with styled headers/cells and clickable row affordance.
- A plan detail renders a shared `Tabs` tab strip whose active tab is visibly and semantically
  marked.
- The tenant wizard step indicator no longer styles completed and current steps identically.
- Focused web-console tests covering the issue scenario pass.
- `openspec validate add-console-plans-design-system --strict` passes.

## Risks and Rollback

This is a frontend-only rendering change. The main risk is an accidental accessibility regression
while replacing local tab wiring; that is mitigated by reusing the already-tested shared `Tabs`
primitive and by asserting the active tab/panel contract in the plan-detail test. Rollback is to
restore the previous page markup while leaving backend and API state untouched.

## Capabilities

### Modified Capabilities

- `web-console`: ADDED requirement for the superadmin Plans catalog/detail and tenant wizard to use
  the shared design-system primitives and theme-aware plan status badges.
