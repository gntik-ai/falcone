# web-console — spec delta for fix-755-secrets-lazy-route-crash

## ADDED Requirements

### Requirement: Console routes reachable by in-app navigation render without synchronous-suspense crash

Every console route reachable by in-app navigation (a synchronous `onClick` → `navigate()`, e.g. the
secret-rotation table's "Rotate" / "History" buttons) SHALL render without throwing React error #426
("a component suspended while responding to synchronous input"). The console SHALL achieve this by
eager-importing the wired pages reachable via synchronous navigation — as the router already does for
the other wired data pages — instead of declaring their route `element` with `React.lazy` (which
suspends synchronously when reached this way, because `future.v7_startTransition` is not enabled and
the route `element` has no enclosing `<Suspense>` boundary). A page MAY remain lazily loaded only when
it is wrapped in its own `<Suspense>` boundary or is not reachable via synchronous in-app navigation
(e.g. the Flows section, code-split for the canvas bundle and entered through navigation that does not
suspend synchronously).

Additionally, the console shell SHALL provide a shell-level `errorElement` so that a render error in
any content route is contained and never replaces the whole shell: the error boundary SHALL render
inside the shell's content `<Outlet/>` (preserving the navigation chrome), present a contained,
on-brand, accessible message with a "back to console" affordance, and SHALL NOT leak a raw minified
stack or the raw thrown-Error message to the operator.

#### Scenario: Clicking Rotate or History on a secrets row renders the rotation page inside the shell

- **WHEN** a user clicks "Rotate" (or "History") on a row of `/console/secrets`
- **THEN** the rotation/history page renders inside the console shell, with no React error boundary
  shown and no loss of the navigation chrome (the page heading "Rotate secret" is present, the shell
  navigation is still mounted, and no route error boundary is displayed).

#### Scenario: A content-route render error is contained without blanking the shell

- **WHEN** a console content route throws while rendering (for example a future lazy-route /
  Suspense regression that triggers React #426)
- **THEN** the shell-level `errorElement` renders a contained, on-brand error message with a
  "back to console" affordance inside the shell's content area, the navigation chrome remains
  mounted, and no raw minified stack or raw thrown-Error message is shown.
