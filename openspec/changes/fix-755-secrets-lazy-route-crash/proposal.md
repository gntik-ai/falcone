## Why

Clicking **Rotate** or **History** on a row of `/console/secrets` crashes the ENTIRE web console.
The whole shell (navigation included) blanks to React error #426 ("A component suspended while
responding to synchronous input") and a minified stack leaks. Root cause:

- `apps/web-console/src/router.tsx` declares the two secret-rotation routes with `React.lazy`:
  `ConsoleSecretsPage` (route `secrets`) and `ConsoleSecretRotationPage`
  (route `secrets/:encodedSecretPath/rotate`). The file's OWN comment (the "Eager (not lazy)" block)
  documents this exact pitfall — "clicking a NavLink to a lazy route suspends synchronously and
  throws React #426 in this build; import these wired pages directly" — and eager-imports every
  OTHER wired data page; these two were missed.
- `apps/web-console/src/pages/ConsoleSecretsPage.tsx` — the Rotate and History buttons both call
  `navigate(\`/console/secrets/${encodeURIComponent(item.secretPath)}/rotate\`)` inside an `onClick`
  (synchronous input → suspends the lazy chunk → React #426). react@18.3.1 +
  react-router-dom@6.30.x, `future.v7_startTransition` is NOT enabled.
- `apps/web-console/src/layouts/ConsoleShellLayout.tsx` renders a bare `<Outlet/>` with NO
  `<Suspense>` boundary, and `createBrowserRouter(appRoutes)` carries NO `errorElement` on the shell
  route, so the #426 error bubbles to react-router's default root boundary and replaces the whole
  element tree (nav lost) while leaking the minified stack.

A deep link (`page.goto('/console/secrets/<path>/rotate')`) renders fine because the lazy element
resolves on the non-synchronous initial-render path — only synchronous in-app `navigate()` triggers
the crash. Independently confirmed on `main` (`0a2307fa`). Persona P16 (web console) / secrets
rotation plane.

## What Changes

- **`apps/web-console/src/router.tsx`** — convert `ConsoleSecretsPage` and
  `ConsoleSecretRotationPage` from `lazy(() => import(...))` to eager top-level named imports
  (matching the established "Eager (not lazy)" block and the file's own documented workaround).
  Remove the now-unused lazy wrappers. This eliminates the synchronous suspension → no React #426.
  The Flows pages stay `lazy` (deliberate code-split for the @xyflow canvas bundle) — out of scope.
- **`apps/web-console/src/router.tsx`** — add a shell-level `errorElement`. The console content
  routes are nested under a new pathless layout route (no `path`/`element`, just `children`) that
  carries `errorElement: <RouteErrorBoundary />`. Because the boundary sits INSIDE
  `ConsoleShellLayout`'s `<Outlet/>`, a content-route render error is contained there with the
  navigation chrome intact, instead of bubbling to the root boundary and blanking the whole shell.
- **`apps/web-console/src/components/RouteErrorBoundary.tsx`** (new) — a contained, on-brand,
  accessible route error boundary built from the design-system `Alert`/`Button` primitives. Uses
  `useRouteError()` / `isRouteErrorResponse()`, shows a "back to console" affordance, and NEVER
  dumps a raw thrown-Error message or stack.
- **Tests** (new):
  - `apps/web-console/src/router.lazy-route-guard.test.tsx` — the RED→GREEN gate. A structural audit
    asserts the `secrets` and `secrets/:encodedSecretPath/rotate` route elements are NOT
    `React.lazy` exotics (`element.type.$$typeof !== Symbol.for('react.lazy')`) and that the shell
    route chain exposes a shell-level `errorElement`; a control assertion proves the `flows` route is
    still lazy (so the detection is non-tautological). Plus behavioral smoke tests that click
    Rotate/History and assert the rotation page renders inside the shell with no error boundary.
  - `apps/web-console/src/components/RouteErrorBoundary.test.tsx` — the boundary renders a contained
    error region with a back-to-console link, never leaks the raw thrown message, and surfaces the
    status/message of a thrown route `Response`.
- **Docs** — `docs/reference/architecture/console-router-error-handling.md`: documents why wired
  pages reachable via synchronous in-app `navigate()` are eager-imported (vs. the intentionally lazy
  Flows section) and the shell-level `errorElement` contract.
- **No contract artifacts changed** — no `*.openapi.json`, generated SDK/types, `internal-contracts`,
  or route catalogs. The API is unchanged; this is a frontend-only fix and re-running codegen
  produces no diff.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — every console route reachable by in-app navigation must
  render without React #426, and a shell-level `errorElement` must contain a route error so it never
  replaces the whole shell. No existing requirement in `openspec/specs/web-console/spec.md` covers
  lazy-route/Suspense handling or route error boundaries, so this is added as `## ADDED Requirements`
  (NOT MODIFIED).
