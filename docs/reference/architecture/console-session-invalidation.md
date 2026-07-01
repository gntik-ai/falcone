# Console session invalidation redirect

The web console stores the active shell session in `window.sessionStorage` through
`apps/web-console/src/lib/console-session.ts`. Protected console routes are guarded by
`apps/web-console/src/components/auth/ProtectedRoute.tsx`.

## Expired or revoked active sessions

When a protected console request fails with `401`, `requestConsoleSessionJson` attempts a silent
refresh using `POST /v1/auth/login-sessions/{sessionId}/refresh`. If the refresh succeeds, the
session snapshot is replaced and the original request is retried with the new access token.

If the refresh cannot proceed or fails definitively because the refresh token is expired, invalid,
or the session was revoked, the console:

- clears the stored shell session;
- persists the login status hint used by the unauthenticated screen;
- emits a browser-local console session invalidation event;
- has every mounted `ProtectedRoute` store the current protected route intent and deny the route,
  which navigates to `/login`.

The authenticated shell and protected child content are unmounted as part of this redirect. The
operator sees the unauthenticated login screen instead of a broken authenticated shell, and the
stored intent allows login recovery to return to the originally requested protected URL.

## Scope

This behavior is frontend-only. It uses the existing `401` response and existing refresh endpoint;
it does not change OpenAPI schemas, generated clients, response shapes, status codes, auth claims,
or backend routes.
