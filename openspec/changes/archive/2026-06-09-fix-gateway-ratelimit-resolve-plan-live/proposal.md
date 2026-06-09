## Why

`services/gateway-config/plugins/scope-enforcement.lua::fetch_plan_requests_per_minute` (line 271) is a stub that always returns `nil`, so `resolve_tenant_rate_limit` always falls back to the static YAML floor and `ctx.var.tenant_rate_limit_rpm` never reflects the tenant's plan ceiling. As a result the runtime ACs of #248 (`add-per-tenant-gateway-rate-limit`) cannot pass: every tenant — starter (120 rpm) or enterprise (2400 rpm) — receives the same static floor, making the plan-driven per-tenant counter partitioning inoperative at request time.

## What Changes

- Wire `fetch_plan_requests_per_minute` in `scope-enforcement.lua` to the live control-plane plan-quota source (the sidecar path already used for denial events via `SCOPE_ENFORCEMENT_SIDECAR_URL`, or a dedicated plan-quota endpoint) so it returns the numeric ceiling from `resolveTenantEffectiveCapabilities` for the given `plan_id` and metric key `tenant.api_requests_per_minute.max`.
- Preserve `resolve_tenant_rate_limit = max(planQuota, staticFloor)` as the grace-period ceiling (design D-risk mitigation from #248).
- Keep the static YAML constant as the sole fallback for unauthenticated or plan-unresolvable requests (design D3 from #248).
- Ensure `ctx.var.tenant_rate_limit_rpm` reflects the resolved per-tenant ceiling at request time, so the `limit-count` plugin and `X-RateLimit-Limit` header emission carry the correct plan-driven value.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: Modify the existing "Plan-quota-driven rate limit ceiling" requirement to add the live-resolution constraint — the system SHALL resolve the ceiling at request time from the control-plane plan-quota source, not from a static constant.

## Impact

- `services/gateway-config/plugins/scope-enforcement.lua::fetch_plan_requests_per_minute` — implement the HTTP lookup (or shared-cache read) against the control-plane plan-quota source; cache result in `plan_rate_limit_cache` keyed `plan_id:metric_key` with TTL `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS` (default 30 s).
- `services/internal-contracts/src/index.mjs::resolveTenantRateLimit` / `resolveTenantEffectiveCapabilities` — consumed as the authoritative quota source (no code change needed here; change is in the Lua consumer).
- `services/internal-contracts/src/domain-model.json` — plan tiers starter (120), growth (600), regulated (1200), enterprise (2400) at metric key `tenant.api_requests_per_minute.max` drive the resolved ceiling.
- `services/gateway-config/base/public-api-routing.yaml` — `planQuotaSource: resolveTenantEffectiveCapabilities` field is already present on all nine qosProfiles; no YAML change required.
- Live verification depends on `fix-gateway-chart-values-schema-inline-config` (the chart must render before `/e2e-issue` can deploy to the test cluster).
