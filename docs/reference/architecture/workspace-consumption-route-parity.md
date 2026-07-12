# Workspace Consumption Route Parity

The workspace detail page renders per-workspace consumption from the plan
management API. The console client calls:

- `GET /v1/workspaces/{workspaceId}/consumption`

Falcone also keeps the explicit tenant form for platform and tenant-specific
administration:

- `GET /v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption`

Both routes are implemented by
`packages/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs`.
The gateway configuration already declares the self route as
`workspace-consumption-self`; the kind runtime route map and the real-stack test
action-runner must declare the same route so local and deployed verification do
not drift from the console path.

## Authorization model

For the self route, there is no `tenantId` path segment. Tenant-scoped callers
therefore resolve tenant scope from the trusted caller context built by the
runtime after authentication:

- tenant owners use `callerContext.actor.tenantId`
- workspace admins use the same tenant id and must also match a trusted
  workspace id
- superadmin and internal callers must use the explicit tenant route because the
  self route has no tenant selector

The explicit tenant route keeps the existing behavior: tenant-scoped callers may
read only their own tenant, and superadmin/internal callers may read the
explicitly targeted tenant.

## Console degradation

If workspace consumption cannot be retrieved, the console renders a clean
unavailable state on `/console/workspaces/{workspaceId}`. It must not display
raw backend route strings such as `NO_ROUTE` or `No action mapped`, because those
are deployment diagnostics rather than tenant-owner guidance.

Successful responses keep the existing response shape:

```text
{
  tenantId,
  workspaceId,
  snapshotAt,
  dimensions: [
    {
      dimensionKey,
      displayLabel,
      unit,
      tenantEffectiveValue,
      workspaceLimit,
      workspaceSource,
      currentUsage,
      usageStatus,
      usageUnknownReason
    }
  ],
  capabilities: [
    {
      capabilityKey,
      displayLabel,
      enabled,
      source
    }
  ]
}
```

This is a route-parity and fallback-behavior fix only. It does not change the
HTTP response schema, frontend TypeScript shape, public OpenAPI document,
generated SDKs, or shared contract artifacts.
