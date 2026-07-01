# web-console - spec delta for fix-738-workspace-route-context

## MODIFIED Requirements

### Requirement: Console workspace routes restore active workspace context

The system SHALL derive the active workspace from the matched `workspaceId` route parameter when that
parameter is present, so opening or refreshing a workspace-scoped console URL restores the active
tenant and workspace context for that workspace, subject to the user's access.

The route workspace SHALL be validated against the user's accessible workspace options before the
console selects or persists it. If the route workspace belongs to one of several accessible tenants,
the console SHALL select that tenant before selecting the workspace. If the route workspace is not
accessible, the console SHALL NOT select that workspace and SHALL NOT fall back to an unrelated
persisted or auto-selected workspace while the inaccessible route workspace remains present.

#### Scenario: Tenant owner deep-links to an accessible workspace route

- **WHEN** a tenant owner opens `/console/workspaces/{workspaceId}` or refreshes/deep-links to a
  workspace-scoped console page directly in a fresh session
- **THEN** the console derives the active tenant and workspace from the route `workspaceId` after
  confirming the workspace is accessible to the user
- **AND THEN** the header shows that workspace as active and the routed page receives workspace
  context instead of rendering `Sin workspace seleccionado` or a no-workspace empty state

#### Scenario: Inaccessible route workspace does not restore unrelated context

- **WHEN** a user opens `/console/workspaces/{workspaceId}` with a route workspace id that is not in
  the user's accessible workspace options
- **THEN** the console does not select or persist that workspace
- **AND THEN** the console does not fall back to a different persisted or auto-selected workspace for
  the active workspace while that route workspace id is present
