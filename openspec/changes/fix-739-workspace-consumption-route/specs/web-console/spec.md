# web-console - spec delta for fix-739-workspace-consumption-route

## MODIFIED Requirements

### Requirement: Workspace detail handles unavailable consumption cleanly

The system SHALL render `/console/workspaces/{id}` with the workspace's
consumption when the consumption request succeeds. If workspace consumption
cannot be retrieved, the page SHALL render a clear non-technical unavailable
state and SHALL NOT leak raw backend route errors such as `NO_ROUTE` or
`No action mapped`.

#### Scenario: Tenant owner opens a workspace detail page

- **WHEN** a tenant owner opens `/console/workspaces/{id}`
- **THEN** the page shows the workspace's consumption when the API returns it
- **AND THEN** if the API cannot retrieve consumption, the page shows a clean
  unavailable state instead of a hard error containing `NO_ROUTE` or
  `No action mapped`
