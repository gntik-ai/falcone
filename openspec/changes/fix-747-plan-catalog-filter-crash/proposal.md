## Why

The plan-catalog status filter in `ConsolePlanCatalogPage` crashes the console for every status
change. The `onChange` handler of the `<select aria-label="status-filter">` passes `e.currentTarget`
into a **functional `setState` updater**:

```jsx
onChange={(e) => setState((current) => ({ ...current, status: e.currentTarget.value, page: 1 }))}
```

React's synthetic event system (react-dom 18.x — `executeDispatch`) **nulls `event.currentTarget`**
immediately after the synchronous handler returns. The functional updater runs later in the render
phase, at which point `e.currentTarget` is `null`. Accessing `.value` on `null` throws:

> TypeError: Cannot read properties of null (reading 'value')

With no router-level `errorElement` in the console, the uncaught error in the render phase blanks the
entire shell. The crash reproduces for every status option (the issue reports 9/9 reproduction
attempts across Draft and Active) and is confirmed on HEAD `10c47a9a`.

Root cause: `apps/web-console/src/pages/ConsolePlanCatalogPage.tsx:21` — the DOM event value is
consumed inside the deferred updater instead of being captured synchronously.

## What Changes

- **`apps/web-console/src/pages/ConsolePlanCatalogPage.tsx`** — capture `e.currentTarget.value`
  synchronously in the handler body (before calling `setState`) and close over the pre-captured
  `const status` in the updater. No other logic changes.
- **`apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx`** — extend with a regression test
  that fires a `change` event on the status filter after initial rows render and asserts that
  `listPlans` is re-invoked with `status: 'draft'` (no crash / throw). The test is RED on the buggy
  code (updater throws → React render error → test failure) and GREEN on the fix.
- **`openspec/changes/fix-747-plan-catalog-filter-crash/specs/web-console/spec.md`** — a new
  `## ADDED Requirements` entry under the `web-console` capability encoding the synchronous event-value
  read rule and the WHEN/THEN scenario.
- **No contract artifacts changed**: no `*.openapi.json`, no generated SDK/types, no
  `internal-contracts`, no OpenAPI diff — this is a pure frontend crash fix.
- **No doc pages added**: the fix is a crash correction on a single line; there is no existing
  web-console coding-guideline doc in the repo to update.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — console form controls must read DOM event values
  synchronously within the handler before entering any deferred `setState` updater. This is a new
  requirement under `web-console` (no existing requirement in `openspec/specs/web-console/spec.md`
  covers this pattern), so it is added as `## ADDED Requirements` rather than MODIFIED.
