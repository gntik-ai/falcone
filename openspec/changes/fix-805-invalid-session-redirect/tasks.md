# Tasks - fix-805-invalid-session-redirect

## 1. Reproduce

- [x] Confirm the existing route guard caches `allowed` after initial session validation.
- [x] Confirm `requestConsoleSessionJson` clears the session after API `401` plus failed silent
      refresh but does not notify mounted route guards.

## 2. Fix

- [x] Add a browser-local invalidation notification for previously active sessions that become
      unusable and cannot be refreshed.
- [x] Make `ProtectedRoute` listen for invalidation, store the current protected route intent, deny
      the route, and navigate to `/login`.
- [x] Preserve missing-session redirects, successful silent refresh recovery, and manual logout
      behavior.

## 3. Tests

- [x] Add a focused Vitest regression for authenticated request `401` followed by refresh `401`.
- [x] Assert session storage is cleared, the route changes to `/login`, protected chrome/content is
      gone, and the protected route intent is preserved.

## 4. Scope / contract discipline

- [x] Keep the change frontend-only.
- [x] Do not change backend routes, OpenAPI/AsyncAPI, generated clients, SDKs, response shapes,
      status codes, auth claims, or route catalog artifacts.

## 5. Docs

- [x] Document the console session invalidation redirect under `docs/reference/architecture/`.
