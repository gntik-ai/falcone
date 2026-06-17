# fix-metrics-quotas-500

## Change type
bug-fix

## Capability
observability (cap-metrics / cap-observability)

## Priority
P2

## Why (Problem Statement)
`GET /v1/metrics/tenants/{id}/quotas` returns 500. The metrics handler throws
`Forbidden` at line 49 (`tenantLimits`) and a related path returns `42P01`
(relation/table not found). The console metrics quota view is non-functional.

**Evidence (live campaign 2026-06-17):**
- `GET /v1/metrics/tenants/{id}/quotas` → 500
- `metrics-handlers.mjs:49 tenantLimits` throws `Forbidden`
- Related path: `42P01` (missing relation) (F4 in the campaign report).

## What Changes
1. Fix the `Forbidden` error — likely a missing DB role permission or incorrect
   connection context for the metrics query.
2. Create/migrate the missing relation (`42P01`) that the quota view depends on.

## Impact
- **Functional:** console metrics quota view is non-functional without this fix.
- **Breaking change:** none.
- **Dependencies:** none known.
