# quotas-plans - spec delta for fix-739-workspace-consumption-route

## MODIFIED Requirements

### Requirement: Workspace consumption is retrievable

The system SHALL serve per-workspace consumption through the workspace self route
`GET /v1/workspaces/{workspaceId}/consumption`, and SHALL keep the explicit
tenant route `GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption`
working, so the console-requested workspace detail consumption path resolves to
the workspace consumption action instead of falling through to `404 NO_ROUTE`.

Tenant-scoped self-route requests SHALL resolve tenant scope from the trusted
`callerContext.actor.tenantId`. Superadmin and internal callers SHALL provide an
explicit `tenantId`. Tenant-scoped callers SHALL be denied when an explicit
tenant path targets a different tenant, and workspace-admin callers SHALL be
limited to their trusted workspace id.

#### Scenario: Tenant owner opens a workspace detail page

- **WHEN** a tenant owner opens `/console/workspaces/{id}` and the console
  requests `GET /v1/workspaces/{id}/consumption`
- **THEN** the kind runtime and action-runner route tables resolve the request to
  `workspace-consumption-get.mjs`
- **AND THEN** the action reads the tenant id from the trusted caller context and
  returns the workspace's consumption for that tenant

#### Scenario: Explicit tenant workspace consumption remains available

- **WHEN** a caller requests
  `GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption`
- **THEN** the request still resolves to `workspace-consumption-get.mjs`
- **AND THEN** tenant-scoped callers can read only their own tenant and
  superadmin/internal callers can read an explicitly targeted tenant
