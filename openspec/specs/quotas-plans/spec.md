# quotas-plans Specification

## Purpose
TBD - created by archiving change fix-plan-impact-usage-bigint. Update Purpose after archive.
## Requirements
### Requirement: Plan-impact usage and limit columns are BIGINT

Plan-impact usage and effective-limit columns SHALL be stored as `BIGINT`. This covers
`tenant_plan_quota_impacts.observed_usage`, `previous_effective_value`, and
`new_effective_value`, because quota values are measured in the dimension's unit (bytes
for storage) and routinely exceed the `INTEGER` range. The migration SHALL upgrade
existing deployments idempotently.

#### Scenario: assigning a plan with multi-GB usage succeeds

- **WHEN** a tenant is assigned a plan whose observed storage usage is several GB
  (greater than the INTEGER maximum)
- **THEN** `POST /v1/tenants/{id}/plan` succeeds (2xx), the impact row is persisted, and
  entitlements reflect the plan (no INTEGER-overflow 500).

