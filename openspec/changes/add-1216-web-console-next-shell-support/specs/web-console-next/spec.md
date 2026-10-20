## ADDED Requirements

### Requirement: Optional page denial copy

Guard and RouteState SHALL accept optional denialTitle and denialDescription.
Unauthorised users SHALL see supplied translated copy; omitted values SHALL use
states.forbidden title and body unchanged. Authorised content SHALL be unchanged.

#### Scenario: Spanish and English denial

- GIVEN an unauthorised role and either supported locale
- WHEN a Guard supplies page denial copy
- THEN the page title and description are visible instead of the defaults.

### Requirement: Explicit navigation migration marker

PendingConsoleRoute SHALL expose an optional migrated marker, defaulting to
false. Sidebar and MobileNav SHALL navigate within the router only for matching
marked targets, deriving the basename from the router. Every unmarked target
SHALL remain a same-tab root-relative legacy anchor. No production route SHALL
be marked in this change.

#### Scenario: Side-by-side navigation

- GIVEN a test-only migrated quotas route and basename /next
- WHEN its sidebar or mobile link is clicked
- THEN the router location changes without document navigation
- AND unmarked flows links keep href /console/flows.

### Requirement: Complete protected intent

ProtectedRoute SHALL preserve basename, pathname, search and hash in the existing
shared intent key, without changing storeProtectedRouteIntent.

#### Scenario: Unauthenticated prefixed URL

- GIVEN /next/console/quotas?x=1#s with no session
- WHEN authentication resolves
- THEN the router redirects to consoleAuthConfig.loginPath
- AND readProtectedRouteIntent returns /next/console/quotas?x=1#s.

#### Scenario: No basename

- GIVEN the existing unprefixed shell tests
- THEN their intent assertions SHALL pass unchanged.

### Requirement: Session-only page tests

A Vitest helper SHALL provide the persisted principal through useSession
synchronously without mounting ProtectedRoute, showing auth loading UI or
calling ensureConsoleSession.

### Requirement: Extensible strict parity backend

Pages SHALL register named method/path endpoints and synthetic fixtures alongside
shell endpoints. Workspace admin and workspace viewer roles SHALL be opt-in per
page manifest. Responses SHALL support delay, failure and fail-then-succeed.
Unknown requests SHALL still fail automatic teardown and external requests SHALL
be aborted. Existing shell role fixtures and checks SHALL remain intact.

#### Scenario: Loading and retry

- GIVEN a registered endpoint and either workspace role
- WHEN its response is delayed
- THEN the page first shows loading
- WHEN a failure is followed by success and the user retries
- THEN the page shows the error followed by the returned data.

### Requirement: Status-aware context failure notice

Context SHALL retain numeric failure status while keeping the boolean error API
compatible. Only a numeric 403 from a tenant or workspace load SHALL use
states.forbidden.body. All other statuses, unknown/missing status, string status
and network errors SHALL use states.network.body in both supported locales.

### Requirement: Existing validation remains enforced

Existing shell, auth, navigation, locale and parity tests SHALL remain enabled.
Translation parity SHALL pass. Source changes SHALL remain within
apps/web-console-next, openspec/changes and docs/README files.
