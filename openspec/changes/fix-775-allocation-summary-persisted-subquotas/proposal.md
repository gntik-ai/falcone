## Why

Tenant owners can create workspace sub-quota allocations through
`POST /v1/workspace-sub-quotas`, and those allocations are persisted in
`workspace_sub_quotas`. The allocation-summary read path used by
`GET /v1/tenant/plan/allocation-summary`, the admin
`GET /v1/tenants/{tenantId}/plan/allocation-summary`, and the web console Allocation
page was reading only an in-memory test store, so real Postgres-backed allocations were
reported as `totalAllocated: 0` with `workspaces: []`.

This made the console's populated workspace allocation table unreachable in real
deployments and hid existing allocations from tenant owners and superadmins.

## What Changes

- `tenant-workspace-allocation-summary-get.mjs` reads sub-quota rows through the
  existing `listSubQuotas` repository API, which supports both the in-memory test store
  and real Postgres `workspace_sub_quotas` records.
- The action keeps the same response shape and authorization behavior while computing
  `totalAllocated`, `unallocated`, `isFullyAllocated`, and `workspaces` from the
  persisted rows.
- Backend regression tests now include a fake Postgres-style client with `query()` and
  no `_workspaceSubQuotas` property, proving that persisted rows are queried and included.
- Web-console regression coverage proves the Allocation page renders the populated table
  when the API returns workspace rows and renders the no-allocation empty state only when
  every dimension has no workspace rows.
- Documentation now records that allocation summaries are backed by
  `workspace_sub_quotas` and that no API schema change is involved.

## Capabilities

### Modified Capabilities

- `quotas-plans`: allocation summary endpoints aggregate persisted workspace sub-quota
  rows instead of an in-memory test store.
- `web-console`: the tenant Allocation page renders the populated allocation table from
  non-empty allocation-summary rows and reserves the empty state for truly unallocated
  summaries.
