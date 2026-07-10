## 1. Reproduce / encode the scenarios

- [x] 1.1 Read issue #753 and confirm the acceptance criteria: accessible shared dialogs, no
  create-tenant wizard data loss on stray backdrop click, keyboard-operable plan rows, single main
  landmark, and design-system filter controls.
- [x] 1.2 Inspect the affected sources: `ui/dialog.tsx`, `WizardShell.tsx`,
  `ConsolePlanCatalogPage.tsx`, named plan/tenant routed pages, `ConsoleOperationsPage.tsx`, and
  `ConsoleObservabilityPage.tsx`.
- [x] 1.3 Add regression tests for shared dialog semantics/focus trap/focus restore/backdrop
  behavior.
- [x] 1.4 Add wizard regression coverage for dirty form data surviving backdrop interaction.
- [x] 1.5 Add plan catalog keyboard navigation coverage through a real link.
- [x] 1.6 Add representative assertions that routed pages do not emit a nested `<main>` and that the
  shell still emits exactly one main landmark.
- [x] 1.7 Add filter-control assertions that residual superadmin filters use the shared `Select`.

## 2. Implement

- [x] 2.1 Upgrade the shared `Dialog` primitive with modal semantics, title/description ARIA
  coordination, focus trap/restore, Escape handling, `DialogClose`, and opt-in outside close.
- [x] 2.2 Update wizard usage so backdrop interaction cannot close/reset dirty wizard data.
- [x] 2.3 Replace the plan catalog mouse-only row navigation with keyboard-operable real links.
- [x] 2.4 Convert remaining routed console page root `<main>` elements to non-main containers so
  `ConsoleShellLayout` owns the only main landmark.
- [x] 2.5 Replace residual raw filter selects in the scoped superadmin/accessibility baseline with
  the shared design-system `Select`.
- [x] 2.6 Keep the change frontend-only; no backend API, OpenAPI, generated client, or realtime
  contract artifacts require updates.

## 3. Docs / OpenSpec

- [x] 3.1 Add this OpenSpec proposal, task list, and web-console spec delta.
- [x] 3.2 Add a console architecture reference for the superadmin accessibility baseline.

## 4. Verify

- [x] 4.1 Run focused web-console tests for the touched dialog, wizard, catalog, page, shell,
  operations, and observability suites.
- [x] 4.2 Run `openspec validate add-superadmin-a11y-baseline --strict`.
- [x] 4.3 Run broader web-console validation if time permits.
