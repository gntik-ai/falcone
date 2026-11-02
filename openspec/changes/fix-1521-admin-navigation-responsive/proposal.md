# Fix admin-navigation responsive check (375/768/1280 px with the menu opened at each width)

## Why

Since #1506 the shell Playwright suite fails in `tests/shell/admin-navigation.spec.mjs` (es: `responsive: horizontal overflow at 375px`, scrollWidth 1260). The test opened the user menu at the default desktop viewport and then called `assertResponsive` at 375, 768 and 1280 px. `assertResponsive` only resizes the viewport, so the popover stayed at its desktop position and inflated the document scroll width. That is a test artefact: the width was never measured with the menu opened at that width.

## What changes

- `apps/web-console-next/tests/shell/admin-navigation.spec.mjs`: the responsive loop is removed from the axe test (its accessibility assertions are unchanged) and replaced by one test per locale (en, es), role (superadmin, tenant_owner) and route (`console/overview`, `admin`). Each test sets the viewport before navigation, then for 375, 768 and 1280 px: asserts the menu is closed, resizes, measures with the menu closed, opens the menu at that width, asserts the expected menuitem is inside the viewport, measures again, attaches screenshots and the measured `scrollWidth`/`clientWidth`, and closes the menu with Escape before the next resize.
- `tests/parity/checks.mjs`, the kit and the shell sources are not changed.

## Overflow finding

Chromium cannot run in the maker sandbox, so the real-viewport probe was not executed there. No shell change is made on the evidence available: the root cause is the stale popover position in the test. If the new test finds a real overflow in PR CI, the fix belongs in `src/shell` (`AdminLayout.tsx`, `Shell.tsx`, `AccountMenu.tsx`) and must keep the accessible names. The PR description must report the measured values from the Playwright attachments.

## Out of scope

Backend, permissions, routing, i18n keys, Helm/chart, `assertResponsive`/`assertAccessibility`, the `@gntik-ai/ui` package.

## Risk and rollback

R1, test only. Roll back by reverting the commit.
