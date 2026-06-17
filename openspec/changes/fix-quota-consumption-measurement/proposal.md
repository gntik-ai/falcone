Tracking issue: gntik-ai/falcone#497

## Why

`GET /v1/tenants/{t}/plan/consumption` and `/v1/metrics/.../usage` return every dimension with `currentUsage:null` / `measuredValue:0` and errors `NO_QUERY_MAPPING` / `CONSUMPTION_QUERY_FAILED`. Because consumption is never measured, usage-based quota enforcement can never fire.

(Evidence: `tests/live-audit/evidence/09-auth-and-governance.md`, `tests/live-audit/evidence/13-metrics.md`.)

## What Changes

- Implement the missing consumption query mappings so each plan dimension is measured against real resource counts (likely tied to the shared-DB wiring in A3).
- Ensure soft/hard limits enforce once consumption reflects real usage.

## Capabilities

### New Capabilities

### Modified Capabilities

- `billing`: Plan consumption reflects real resource counts per tenant, and soft/hard quota limits enforce.

## Impact

- Consumption query mappings behind `GET /v1/tenants/{t}/plan/consumption` and `/v1/metrics/.../usage`.
- Ties into A3 (`fix-postgres-tenant-db-isolation-and-rls`) shared-DB wiring.
