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

## Next-console retry 401 opt-in

`packages/console-api/src/session.ts` exports
`setConsoleSessionRetryUnauthorizedHandler(handler: (() => void) | null)`. There is no default
handler. It is invoked only when the request retried after a successful refresh rejects with
numeric status `401`; the same error is then rethrown. Initial failures, missing-access-token
errors and non-401 retry failures do not invoke it. Refresh deduplication, refresh retries and
the original request retry order are unchanged.

`invalidateConsoleShellSession()` is the idempotent handler: if a persisted session exists, it
uses the existing clear, expired-hint and invalidation-event primitives. Once that session is
cleared, subsequent concurrent retry 401s do nothing. It makes no refresh, termination or other
request, and clears only local state, matching refresh failure.

Only `apps/web-console-next/src/main.tsx` registers this handler, before rendering. This covers
both page requests and shell context loaders through the shared request API. Its single
registration call is the kill switch; removing it restores the prior retry-401 behavior.
The legacy app never registers the handler and retains its behavior. The apps share the same
sessionStorage key, so clearing a next-console session also signs out the legacy console in
that tab, as refresh failure already does.

At both `/` and `/next/`, the next console's `ProtectedRoute` responds to invalidation by
unmounting protected content and navigating to `consoleAuthConfig.loginPath`, preserving the
full protected route intent including basename, query and hash. It displays no 401 error panel
or network notice. Consuming that intent after login is outside this change.

This is the R3 ChangeSet for issue #1224: human approval and both providers are required before
merge. The operator separately verifies the three refresh outcomes on staging at `/next/`
and unchanged legacy `/` behavior before any falcone v* release. There are no chart changes.

## Scope

This behavior is frontend-only. It uses the existing `401` response and existing refresh endpoint;
it does not change OpenAPI schemas, generated clients, response shapes, status codes, auth claims,
or backend routes.
