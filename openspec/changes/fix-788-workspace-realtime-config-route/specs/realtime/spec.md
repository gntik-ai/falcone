# realtime - spec delta for fix-788-workspace-realtime-config-route

## ADDED Requirements

### Requirement: Workspace realtime config route serves the shipped console page

The system SHALL register `GET /v1/workspaces/{workspaceId}/realtime` for the shipped workspace
Realtime config page and return tenant-scoped realtime metadata in the response shape the page
renders. The route SHALL NOT fall through to `404 NO_ROUTE` for an existing workspace owned by the
verified caller's tenant.

#### Scenario: Realtime config resolves for a tenant-owned workspace

- **WHEN** a tenant owner opens `/console/workspaces/{workspaceId}/realtime`
- **THEN** `GET /v1/workspaces/{workspaceId}/realtime` resolves to a real handler
- **AND THEN** the handler returns `200` with `workspaceId`, `features.realtime`, `dataSources`,
  and `realtimeEndpointUrl`
- **AND THEN** the console renders the realtime config/snippets page instead of the error-only
  `404 NO_ROUTE` branch.

#### Scenario: Tenant caller requests a foreign workspace realtime config

- **WHEN** a tenant-scoped caller requests `GET /v1/workspaces/{workspaceId}/realtime` for a
  workspace owned by another tenant
- **THEN** the route returns `404 WORKSPACE_NOT_FOUND`
- **AND THEN** it does not query or reveal that workspace's realtime channel rows.
