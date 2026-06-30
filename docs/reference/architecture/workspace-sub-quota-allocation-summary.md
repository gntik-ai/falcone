# Workspace Sub-Quota Allocation Summary

Falcone stores per-workspace slices of a tenant quota in the
`workspace_sub_quotas` table. The write and list endpoints use this table:

- `POST /v1/workspace-sub-quotas`
- `GET /v1/workspace-sub-quotas`

The tenant allocation-summary endpoints use the same persisted rows as their source of
truth:

- `GET /v1/tenant/plan/allocation-summary`
- `GET /v1/tenants/{tenantId}/plan/allocation-summary`

The summary first resolves the tenant's effective quantitative limits, then groups all
persisted sub-quota rows for that tenant by `dimension_key`. For each dimension it returns:

- `tenantEffectiveValue`: the effective tenant-level limit
- `totalAllocated`: the sum of persisted `allocated_value` rows for that dimension
- `unallocated`: `tenantEffectiveValue - totalAllocated`, or `null` for unlimited
  dimensions
- `isFullyAllocated`: `true` when a bounded dimension has no remaining unallocated quota
- `workspaces`: one entry per persisted workspace allocation, with `workspaceId` and
  `allocatedValue`

When a tenant has no `workspace_sub_quotas` rows, the endpoints still return every
quantitative dimension from the effective plan, but each dimension has `totalAllocated: 0`
and `workspaces: []`. The web console uses that shape to show the "No workspace
allocations yet" empty state. When any dimension contains workspace rows, the console
renders `WorkspaceAllocationSummaryTable` with the populated breakdown.

This is a source-of-truth fix only. The HTTP response schema, route paths, frontend
TypeScript types, OpenAPI artifacts, and generated SDK surfaces do not change.
