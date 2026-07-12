# Console account status views

The web console uses account status views for public auth edge states that can
be reached before an operator has an active session. The primary clean-load path
is `/signup/pending-activation`, where `PendingActivationPage` requests:

```text
GET /v1/auth/status-views/pending_activation
```

The public API contract defines the canonical route as:

```text
GET /v1/auth/status-views/{statusViewId}
```

and the response body as `ConsoleAccountStatusView`:

```json
{
  "statusView": "pending_activation",
  "title": "Tu registro está pendiente de activación",
  "message": "Hemos recibido tu solicitud de acceso, pero todavía necesita aprobación o activación antes de entrar en la consola.",
  "allowedActions": []
}
```

The pending-activation status view intentionally returns no canonical action
links. `PendingActivationPage` already renders the concrete login/signup escape
actions for the clean-load page, while `LoginPage` falls back to its
`/signup/pending-activation` link when a login attempt is rejected because the
account is still pending activation.

## Runtime route

The kind control-plane runtime serves the route with the public local handler
`getConsoleAccountStatusView` from
`apps/control-plane/auth-handlers.mjs`.

The handler is intentionally static and dependency-free. It does not call
Keycloak, query the database, or require an authenticated identity. This keeps
public auth pages routable during unauthenticated clean loads and prevents a
missing status-view route from surfacing as `404 NO_ROUTE`.

The runtime route is registered in both:

- `apps/control-plane/routes.mjs`, the seed route table used by unit
  tests and local server startup.
- `apps/control-plane/route-map.runtime.json`, the route table copied
  into the kind image through `ROUTE_MAP_FILE`.

The reference catalog entry in `apps/control-plane/route-map.json` also
points to the same local handler so the advertised route no longer appears as a
gap.

## Supported views

The supported `statusViewId` values mirror the public contract enum
`ConsoleStatusViewId`:

- `login`
- `signup`
- `pending_activation`
- `account_suspended`
- `credentials_expired`
- `password_recovery`

Each supported id returns `200` with a `ConsoleAccountStatusView` body. Unknown
ids return:

```json
{
  "code": "STATUS_VIEW_NOT_FOUND",
  "message": "Unknown console account status view: not_a_real_view"
}
```

with HTTP status `404`.
