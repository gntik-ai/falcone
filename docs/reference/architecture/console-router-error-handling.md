# Console router — lazy-route handling and the shell error boundary

The web console is a single-page React Router app. Its route tree lives in
`apps/web-console/src/router.tsx` (`appRoutes` + `createBrowserRouter`). This page documents two
invariants that keep in-app navigation from crashing the whole console: **when a wired page may be
lazily loaded**, and the **shell-level error boundary** contract.

## Eager-import wired pages reachable via synchronous navigation

The console pins react-router-dom v6 with `future.v7_startTransition` **not** enabled, and the route
`element`s are not individually wrapped in a `<Suspense>` boundary. Under those conditions, a route
whose `element` is a `React.lazy(...)` component **suspends synchronously** when it is reached by a
synchronous in-app navigation — a `navigate()` call inside an `onClick` handler. React treats that as
"a component suspended while responding to synchronous input" and throws **React error #426**.

Because there is no enclosing `<Suspense>`, the throw is not caught locally; it bubbles to the
router's error boundary (see below). Before this contract existed, that meant a single click could
blank the entire console.

**Rule:** a wired page that is reachable through a synchronous in-app `navigate()` (e.g. a button in a
table row) MUST be **eager-imported** at the top of `router.tsx` (a normal
`import { Page } from '@/pages/Page'`), not declared with `React.lazy`. The router already groups
these under the `// Eager (not lazy)` comment block. This is why the secret-rotation pages
(`ConsoleSecretsPage` and `ConsoleSecretRotationPage`, reached from the Rotate/History buttons on
`/console/secrets`) are eager imports. (#755)

A page MAY stay lazily loaded only when **either** it is wrapped in its own `<Suspense>` boundary,
**or** it is not reached by synchronous in-app navigation. The **Flows** section is the deliberate
code-split exception: its pages stay `React.lazy` so the `@xyflow/react` canvas chunk (~hundreds of
kB) stays out of the initial shell bundle. Keeping Flows lazy is intentional; do not eager-import it
to "fix" a suspended-input symptom — wrap it or change how it is entered instead.

> Note (follow-up): the Flows pages share the synchronous-suspense defect for their own in-app
> navigations and need a separate fix (enabling `future.v7_startTransition` and/or a `<Suspense>`
> boundary, with browser verification) so they can stay code-split. The shell error boundary below
> contains that crash gracefully in the meantime.

## The shell-level `errorElement`

The console content routes are nested under a **pathless layout route** (no `path`, no `element`,
just `children`) that carries `errorElement: <RouteErrorBoundary />`
(`apps/web-console/src/components/RouteErrorBoundary.tsx`). That pathless route sits **inside** the
`ConsoleShellLayout` route, so its element renders into the shell's content `<Outlet/>`.

This placement is deliberate. If the `errorElement` were attached to the `ConsoleShellLayout` route
itself, an error in a child content route would bubble up and replace the **entire** shell — the
navigation chrome would be lost. By nesting the content routes under a pathless route that owns the
`errorElement`, a content-route render error is contained **one level down**: react-router renders
`RouteErrorBoundary` in the shell's `<Outlet/>` while the surrounding header and sidebar navigation
stay mounted.

`RouteErrorBoundary` is built from the design-system primitives (`Alert`, `Button`), reads the error
via `useRouteError()` / `isRouteErrorResponse()`, offers a "back to console" affordance, and **never**
renders a raw thrown-Error message or stack trace. For a thrown route `Response` it surfaces the
status and message; for any other error it shows a generic, on-brand message.

**Rule:** keep a shell-level `errorElement` on the pathless layout route that wraps the console
content routes, so any future render error in a content route degrades to a contained, on-brand
message with the navigation intact — never a whole-shell blank or a leaked minified stack.
