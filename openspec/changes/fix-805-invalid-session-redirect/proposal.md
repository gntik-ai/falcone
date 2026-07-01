# fix-805-invalid-session-redirect

## Why

The web console can strand an operator on a broken authenticated shell after the active session is
revoked or expires out from under the SPA. `requestConsoleSessionJson` clears the stored session
when an authenticated request returns `401` and the silent refresh also fails, but mounted
`ProtectedRoute` instances have already cached `allowed` and receive no redirect signal. The result
is a route such as `/console/members` with session storage cleared, no login screen, and
authenticated chrome still rendered. (GitHub issue #805.)

## What Changes

- Emit a browser-local console session invalidation notification from
  `apps/web-console/src/lib/console-session.ts` when a previously active session becomes unusable
  and cannot be refreshed.
- Subscribe `ProtectedRoute` to that notification while mounted. On invalidation it stores the
  current protected route intent, denies the guard, and navigates to `/login`.
- Add a focused Vitest regression that renders an authenticated protected route, triggers
  `requestConsoleSessionJson`, returns API `401` followed by refresh `401`, and asserts the session
  is cleared, `/login` is shown, intent is preserved, and protected chrome/content is gone.
- Document the frontend-only session invalidation redirect in
  `docs/reference/architecture/console-session-invalidation.md`.

## Out of scope

- No backend, OpenAPI, SDK, route-catalog, response-shape, status-code, or auth-claims change is
  required. The console continues to use the existing `401` response and refresh endpoint.
