# Console Wayfinding and Responsive Shell

The authenticated web console shell owns wayfinding that is shared by every `/console/*`
screen: primary navigation, active tenant/workspace context, breadcrumbs, and route-level
recovery states.

## Shell Controls

- The primary navigation remains in the desktop sidebar at `xl` and wider, matching the
  breakpoint where the desktop tenant/workspace selectors appear in the header.
- Below `xl`, the header exposes a "Navegación y contexto" drawer. The drawer contains the
  same navigation model and the same active tenant/workspace selectors as the desktop header,
  so there is no viewport width where a signed-in user loses navigation or context selection,
  and no intermediate width where two primary navigation systems compete.
- The drawer uses the shared console modal focus-trap helper: focus moves into the drawer,
  Tab stays within it, Escape closes it, and focus returns to the trigger.
- The shell includes a skip-to-content link targeting and focusing `#console-main-content` for
  keyboard users who want to bypass repeated chrome.
- The shell owns the only `<main>` landmark in authenticated console routes. Routed page
  components render non-main containers inside it, so the skip target remains unambiguous for
  assistive technology; see
  [console-superadmin-accessibility-baseline.md](./console-superadmin-accessibility-baseline.md).

## Breadcrumbs

The shell renders a breadcrumb trail above console content. Breadcrumbs are derived from the
current route and the existing navigation metadata so labels do not drift from the sidebar.
Known deep routes add parameter-aware breadcrumb tails:

- `/console/workspaces/:workspaceId`
- `/console/flows/:flowId`
- `/console/flows/:flowId/runs/:executionId`
- `/console/operations/:operationId`
- `/console/plans/:planId`
- `/console/tenants/:tenantId/plan`

The current route is marked with `aria-current="page"` and parent breadcrumbs link back to the
relevant console section.

## Access Denials

Route guards must render explicit in-place states rather than redirecting silently. Superadmin
routes and workspace-secret routes use `ConsolePageState kind="blocked"` with copy that names
the missing access and keeps the requested route visible in the address bar. This prevents a
user from clicking a route and being sent to an unrelated page without explanation.

Unknown authenticated `/console/*` routes render an in-shell route-not-found recovery state.
The copy tells the user that their session and active context are preserved, then offers a
primary route back to the console overview and a secondary back action. The unauthenticated
catch-all remains handled by the public `NotFoundPage` under `AuthLayout`.
