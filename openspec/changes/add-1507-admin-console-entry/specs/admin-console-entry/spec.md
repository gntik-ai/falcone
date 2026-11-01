# Administrator console entry point

## ADDED Requirements

### Requirement: Superadmin-only /admin entry

The web console SHALL serve `/admin` behind `ProtectedRoute`. A session whose `principal.platformRoles` includes `superadmin` SHALL see the header title `Administrator console` (`Consola de administración` in es), a landing `h1`, a short description and a `Back to console` link to `/console`, inside `SidebarLayout`, `AppSidebar` and `AppTopbar` with `AccountMenu`, an empty navigation and no `ContextPanel`. The route SHALL NOT mount the console context or permissions providers and SHALL make no API request.

#### Scenario: Superadmin opens /admin

- GIVEN a usable superadmin session
- WHEN the user opens `/admin`
- THEN the shell, the heading and the description render
- AND no request is made.

#### Scenario: Back to console

- GIVEN the superadmin landing page
- WHEN the user activates `Back to console`
- THEN the app navigates to `/console` and the console index redirect applies.

### Requirement: Denied roles

A session without `superadmin` SHALL see the 403 state with the primary action `Back to console` navigating to `/console`. No admin heading, description or header title SHALL be rendered. Existing `/console` forbidden states SHALL keep the `Overview` action to `/console/overview`.

#### Scenario: Non-superadmin opens /admin

- GIVEN a session with `tenant_owner`, `workspace_admin` or `tenant_member`
- WHEN the user opens `/admin`
- THEN the 403 state renders with `Back to console`
- AND no request is made.

### Requirement: Login return to /admin

An unauthenticated visit to `/admin` SHALL navigate to the login path and store the admin URL as the protected-route intent. After sign-in the resolver SHALL accept `${base}/admin` exactly or followed by `/`, `?` or `#`, and SHALL ignore `//evil`, `/login`, `/administrator` and `${base}/adminx`. Without an accepted intent the default landing is unchanged.

#### Scenario: Lookalike intent

- GIVEN a stored intent `/administrator`
- WHEN sign-in completes
- THEN the app lands on the default console landing.

### Requirement: Lazy page and i18n parity

The landing page SHALL load through `lazyPage` in its own chunk, and the `admin` namespace SHALL have identical key sets in en and es.

#### Scenario: Production build

- GIVEN the production build
- WHEN the output is inspected
- THEN the admin page is emitted in a separate chunk
- AND `check:i18n` passes.
