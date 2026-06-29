## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (`0a2307fa`): `apps/web-console/src/router.tsx` declares
  `ConsoleSecretsPage` (route `secrets`) and `ConsoleSecretRotationPage`
  (route `secrets/:encodedSecretPath/rotate`) with `React.lazy`; `ConsoleSecretsPage.tsx`'s Rotate
  and History buttons `navigate()` to the rotation route inside an `onClick`; `ConsoleShellLayout`'s
  `<Outlet/>` has no `<Suspense>` and the router has no `errorElement` → synchronous suspense throws
  React #426 and the root boundary blanks the whole shell.
- [x] 1.2 Add the RED→GREEN structural gate `apps/web-console/src/router.lazy-route-guard.test.tsx`:
  assert the `secrets` and `secrets/:encodedSecretPath/rotate` route elements are NOT `React.lazy`
  exotics (`element.type.$$typeof !== Symbol.for('react.lazy')`); assert the shell route chain
  exposes a shell-level `errorElement`; control-assert the deliberately code-split `flows` route IS
  still lazy (non-tautological). RED on `main` (those routes are lazy, no `errorElement`), GREEN on
  this branch.
- [x] 1.3 Add behavioral smoke tests in the same file: render `appRoutes` via `createMemoryRouter`
  at `/console/secrets`, click "Rotate" / "History", assert the "Rotate secret" page renders inside
  the (stubbed) shell with the nav chrome present and no `console-route-error-boundary`.
- [x] 1.4 Add `apps/web-console/src/components/RouteErrorBoundary.test.tsx`: the boundary renders a
  contained error region with a back-to-console link, never leaks the raw thrown message, and
  surfaces the status + message of a thrown route `Response`.

## 2. Fix (minimal, frontend-only)

- [x] 2.1 `apps/web-console/src/router.tsx` — replace the `ConsoleSecretsPage` and
  `ConsoleSecretRotationPage` `lazy(() => import(...))` wrappers with eager top-level named imports
  (`import { ConsoleSecretsPage } from '@/pages/ConsoleSecretsPage'`, likewise for
  `ConsoleSecretRotationPage`), matching the existing "Eager (not lazy)" block. Remove the unused
  wrappers. Keep the Flows pages lazy (out of scope).
- [x] 2.2 `apps/web-console/src/components/RouteErrorBoundary.tsx` (new) — a contained, on-brand,
  accessible route error boundary using `useRouteError()` / `isRouteErrorResponse()` and the
  design-system `Alert`/`Button` primitives, with a "back to console" affordance and no raw stack.
- [x] 2.3 `apps/web-console/src/router.tsx` — nest the console content routes under a new pathless
  layout route carrying `errorElement: <RouteErrorBoundary />`, so a content-route error renders
  inside `ConsoleShellLayout`'s `<Outlet/>` (nav intact) instead of bubbling to the root boundary.
  Verified no existing route path changed (index redirect, `*` catch-all, ProtectedRoute /
  ConsoleShellLayout nesting all preserved).

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — pure frontend fix; no `*.openapi.json`, generated types,
  `internal-contracts`, gateway route YAML, or `public-route-catalog.json` edited. Re-running codegen
  produces no diff.
- [x] 3.2 Docs: add `docs/reference/architecture/console-router-error-handling.md` documenting the
  eager-import rule for synchronously-navigable wired pages (vs. the intentionally lazy Flows section)
  and the shell-level `errorElement` contract.
- [x] 3.3 Spec delta: `openspec/changes/fix-755-secrets-lazy-route-crash/specs/web-console/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED) under the `web-console` capability; one new requirement with
  the two WHEN/THEN scenarios from the issue.

## 4. Verify

- [ ] 4.1 CI runs `pnpm --filter @in-falcone/web-console test` (the `web-console` vitest job) — the
  new tests are the executed regression gate. Local vitest/tsc execution is gated in this
  environment; CI is the authoritative check.
- [ ] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only `apps/web-console/src/`,
  `docs/`, and `openspec/changes/fix-755-secrets-lazy-route-crash/` (force-added past `.gitignore`).
- [ ] 4.3 `openspec validate fix-755-secrets-lazy-route-crash --strict` (if the CLI is available;
  otherwise CI / hand-verification against a merged sibling change).
