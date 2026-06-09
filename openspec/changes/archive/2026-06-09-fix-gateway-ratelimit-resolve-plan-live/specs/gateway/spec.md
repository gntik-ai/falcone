## MODIFIED Requirements

### Requirement: Plan-quota-driven rate limit ceiling

The system SHALL resolve each tenant's effective `requestsPerMinute` ceiling
from the live control-plane plan-quota source at request time (not from a static
constant) so that `ctx.var.tenant_rate_limit_rpm` and the `X-RateLimit-Limit`
response header reflect the tenant's active plan tier — with premium-plan tenants
receiving a strictly higher ceiling than free-plan tenants.

The resolution SHALL reuse the `scope-enforcement` plugin's plan-capability cache
(`plan_rate_limit_cache`, TTL governed by `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS`,
default 30 s) to avoid a second per-request lookup, consistent with design decision
D2 from `add-per-tenant-gateway-rate-limit`.

The effective ceiling SHALL be `max(planQuota, staticFloor)` during the grace period
so that a plan downgrade never drops a tenant below the previously published static
budget; the static YAML constant SHALL remain the fallback when the plan is
unresolvable or the request is unauthenticated (design D3).

#### Scenario: Premium-plan tenant receives live plan-driven limit at request time

- **WHEN** an enterprise-plan tenant (plan tier with `tenant.api_requests_per_minute.max` = 2400) authenticates and the control-plane plan-quota source is reachable
- **THEN** `ctx.var.tenant_rate_limit_rpm` is set to 2400 (or `max(2400, staticFloor)`) and the `X-RateLimit-Limit` header on the response reflects that value — NOT the static floor shared with free-plan tenants

#### Scenario: Free-plan tenant receives its plan-driven limit, strictly lower than premium

- **WHEN** a starter-plan tenant (plan tier with `tenant.api_requests_per_minute.max` = 120) and an enterprise-plan tenant both authenticate and call the same `/v1/*` route family
- **THEN** the runtime-resolved `requestsPerMinute` (and `X-RateLimit-Limit`) for the enterprise tenant is strictly greater than for the starter tenant, and neither value equals the other tenant's ceiling

#### Scenario: Unauthenticated request falls back to static floor without error

- **WHEN** a request arrives without a valid `X-Tenant-Id` header or with an unresolvable plan identifier
- **THEN** the gateway applies the static default `requestsPerMinute` from the qosProfile YAML, does not attempt a plan-quota lookup, and returns no error to the caller

#### Scenario: Plan-quota cache miss triggers control-plane lookup, result is cached

- **WHEN** `fetch_plan_requests_per_minute` is called for a `plan_id` not yet present in `plan_rate_limit_cache`
- **THEN** the plugin performs exactly one HTTP request to the control-plane plan-quota source, stores the result in `plan_rate_limit_cache` under key `plan_id:tenant.api_requests_per_minute.max` with TTL `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS`, and subsequent calls within the TTL window return the cached value without a second lookup

#### Scenario: Control-plane plan-quota source unreachable falls back to static floor

- **WHEN** the control-plane plan-quota source is unreachable or returns a non-numeric value for the tenant's plan
- **THEN** `fetch_plan_requests_per_minute` returns `nil`, `resolve_tenant_rate_limit` returns the static floor, and the gateway continues to serve the request without error
