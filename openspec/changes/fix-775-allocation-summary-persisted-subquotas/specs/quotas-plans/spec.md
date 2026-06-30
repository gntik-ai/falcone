# quotas-plans - spec delta for fix-775-allocation-summary-persisted-subquotas

## MODIFIED Requirements

### Requirement: Tenant allocation summary aggregates persisted sub-quotas

The system SHALL compute `GET /v1/tenant/plan/allocation-summary` and admin
`GET /v1/tenants/{tenantId}/plan/allocation-summary` from the persisted
`workspace_sub_quotas` records, so per-dimension `totalAllocated`, `unallocated`,
`isFullyAllocated`, and the `workspaces` breakdown reflect allocations created via
`POST /v1/workspace-sub-quotas`.

#### Scenario: Summary reflects a persisted allocation

- **WHEN** a sub-quota allocation exists in `workspace_sub_quotas` for a
  tenant/workspace/dimension
- **THEN** the allocation summary for that tenant returns the matching `workspaces`
  entry and a `totalAllocated` that includes it

#### Scenario: Empty summary reflects no persisted allocations

- **WHEN** a tenant has no `workspace_sub_quotas` rows
- **THEN** the summary returns every dimension with `workspaces: []`,
  `totalAllocated: 0`, and unallocated values computed from the tenant effective limits
