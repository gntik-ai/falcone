# Add superadmin-only /admin entry point to web-console-next

## Why

The superadmin works in the same `/next` console as tenant users. Issue #1507 asks for a separate administrator console and, in this change, only its guarded entry point. Before this change `/admin` fell through to the root `*` not-found route.

## What changes

All changes are in `apps/web-console-next`.

- `src/router.tsx` adds a top-level `/admin` route wrapped in `ProtectedRoute`. The layout is `src/shell/AdminLayout.tsx` (lazy) and the index child is `src/pages/admin.tsx` (via `lazyPage`).
- `AdminLayout` composes `SidebarLayout`, `AppSidebar`, `AppTopbar` and `AccountMenu` with an empty navigation, the header title from the `admin` namespace, no `ContextPanel` and no `ConsoleContextProvider` or `PermissionsProvider`. It reads only `session.principal.platformRoles` and does not call `Guard`, `useConsoleContext` or `usePermissions`, so rendering `/admin` makes no tenant or workspace request.
- `RouteState` gains an optional `primaryAction` override (`label`, `to`). Without it the output is unchanged (`Overview` to `/console/overview`). Denied users see the 403 state with `Back to console` to `/console`; the secondary `Back` is kept.
- `src/pages/login.tsx` accepts a stored intent equal to `${base}/admin`, or that path followed by `/`, `?` or `#`. The `//` rejection and the `${base}/console/` rule are unchanged, as is the default landing.
- `src/App.tsx` treats `/admin` like `/console` for the outer header, so the layout owns the page.
- `src/locales/{en,es}/admin.json` have identical key sets.
- `tests/router.test.tsx` expects `/admin` and `/admin/` in addition to the previous set. This is the only existing expectation that changes.

## Decisions on the open questions

- The allowlist accepts the exact path plus `/`, `?`, `#` boundaries.
- The superadmin check stays local to `AdminLayout`; `Guard` is unchanged.
- The 403 keeps RouteState's secondary `Back`.
- The landing page sets only the `h1`, not `document.title`.

## Out of scope

Admin pages or nav entries, moving console pages, ConsoleShell adoption (#1497), backend or gateway authorization, the legacy console, and any `falcone-charts` change.

## Risk and rollback

The client-side guard only hides UI; the backend remains the enforcement point. The controlling risk class is R3 per the control plane; the delivery owner reconciles it with the R2 proposed in the issue. Rollback is a revert and redeploying the previous `web-console-next` image digest; `/admin` then returns to the not-found page. The static server fallback for `/next/*` is outside this change and no serving gap is fixed here.
