Tracking issue: gntik-ai/falcone#497

## Why

`GET /v1/tenants/{t}/plan/consumption` and `/v1/metrics/.../usage` return every dimension with `currentUsage:null` / `measuredValue:0` and errors `NO_QUERY_MAPPING` / `CONSUMPTION_QUERY_FAILED`. Because consumption is never measured, usage-based quota enforcement can never fire.

(Evidence: `tests/live-audit/evidence/09-auth-and-governance.md`, `tests/live-audit/evidence/13-metrics.md`.)

## What Changes

- Root cause (verified against the live `in_falcone` schema): the consumption resolvers queried tables that do not exist there (`pg_databases`/`functions`/`kafka_topics`/`storage_objects`/`api_call_logs`/`workspace_members`) and omitted half the `quota_dimension_catalog` keys — so every dimension returned `NO_QUERY_MAPPING` or `CONSUMPTION_QUERY_FAILED`. Map each catalog dimension to the real live table (`workspace_databases` split by `engine` for pg/mongo, `workspace_functions`, `workspace_topics`, `workspace_api_keys`, `workspaces`), decoupling the live table name from the integration suite's in-memory keys so both paths work.
- `max_storage_bytes` (object store) and `max_workspace_members` (Keycloak) have no control-plane data source, so they measure 0 instead of erroring — real metering of those is deferred to observability (#499) / IAM.
- With consumption now real for the countable dimensions, soft/hard limits can enforce against actual usage.

## Capabilities

### New Capabilities

### Modified Capabilities

- `billing`: Plan consumption reflects real resource counts per tenant, and soft/hard quota limits enforce.

## Impact

- Consumption query mappings behind `GET /v1/tenants/{t}/plan/consumption` and `/v1/metrics/.../usage`.
- Ties into A3 (`fix-postgres-tenant-db-isolation-and-rls`) shared-DB wiring.
