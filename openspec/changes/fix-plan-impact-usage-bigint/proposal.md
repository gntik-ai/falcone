# fix-plan-impact-usage-bigint

## Change type
bugfix

## Capability
quotas-plans

## Priority
P1

## Why
`POST /v1/tenants/{id}/plan` -> 500; `tenant_plan_quota_impacts.observed_usage` is INTEGER but usage is reported in bytes (e.g. 5 GB) -> overflow.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: every plan assignment returns 500; both seeded tenants ended with plan=None. Migration `100-plan-change-impact-history.sql`.

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/10-tenant-project-quota-provisioning-audit.md`.

## What Changes
Change `observed_usage` (and sibling usage columns) to BIGINT.

## Impact
Plan assign -> 2xx; entitlements reflect the plan; large byte usage stored without error.
