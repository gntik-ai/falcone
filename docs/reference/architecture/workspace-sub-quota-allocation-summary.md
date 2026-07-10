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

Console rendering requirements:

- `/console/my-plan/allocation` renders its page heading and plan wayfinding before
  loading, error, tenant-less, empty, and populated states, so the common empty state is
  never a title-less orphan card.
- Empty/loading/error states use the shared `ConsolePageState` treatment with an icon.
- The table renders numeric quota values with the dimension unit. Byte dimensions are
  humanized through the shared console formatter; count-like dimensions keep their unit
  label alongside the value.
- Workspace breakdown entries render as separate rows inside the breakdown cell. If a
  response includes a human-readable workspace label alias (`displayLabel`,
  `workspaceDisplayName`, `workspaceName`, `workspaceSlug`, `name`, or `slug`), the
  console uses that label. If the only available workspace identifier is UUID-like, the
  console uses an ordinal label (for example, "Área de trabajo 1") instead of presenting
  the raw UUID as the primary copy.
- The tenant identifier from the response is not surfaced as raw UUID primary copy in the
  page header.

This remains a frontend-rendering fix only. The HTTP response schema, route paths,
OpenAPI artifacts, and generated SDK surfaces do not change; the console TypeScript type
only tolerates optional workspace label aliases when a runtime includes them.
