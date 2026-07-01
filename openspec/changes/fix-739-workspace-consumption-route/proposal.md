## Why

The workspace detail page requests
`GET /v1/workspaces/{workspaceId}/consumption`, but the kind control-plane runtime
only routed the explicit tenant variant,
`GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption`. A tenant owner
opening `/console/workspaces/{id}` therefore saw a raw `404 NO_ROUTE` failure
instead of workspace consumption.

Even after adding the missing route, the action needed to resolve the tenant id
from the trusted caller context for the self route because that path has no
`tenantId` segment.

## What Changes

- Register `GET /v1/workspaces/{workspaceId}/consumption` in the kind runtime
  route map and the test action-runner route table, mapped to the existing
  `workspace-consumption-get.mjs` action.
- Keep the existing explicit tenant route
  `GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption` available.
- Update the workspace consumption action so tenant-scoped self-route callers
  derive tenant scope from the trusted `callerContext.actor.tenantId`, while
  superadmin/internal callers still require an explicit `tenantId`.
- Preserve cross-tenant denial and require workspace-admin callers to match a
  trusted workspace id.
- Update the workspace dashboard page so consumption load failures render a
  clean unavailable state and do not expose raw backend strings such as
  `NO_ROUTE` or `No action mapped`.
- Add focused backend route/action tests and web-console rendering coverage.

## Capabilities

### Modified Capabilities

- `quotas-plans`: workspace consumption is reachable through the self route the
  console calls and remains reachable through the explicit tenant route.
- `web-console`: the workspace detail page renders consumption on success and a
  non-technical unavailable state on failure.

## Contract Notes

No public OpenAPI, SDK, or generated shared type change is required. The console
service client already calls the self route, and the gateway route catalog already
contains `workspace-consumption-self`; this change synchronizes the kind runtime
route map and test action-runner with that existing route and preserves the
response shape.
