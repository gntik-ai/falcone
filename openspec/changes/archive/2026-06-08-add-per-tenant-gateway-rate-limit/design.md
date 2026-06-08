## Context

Falcone's APISIX gateway enforces rate limits via the `limit-count` and
`limit-req` plugins. The current `qosProfile` config defines one shared counter
per route class (`rateLimitClass`). APISIX supports a `key` parameter on
`limit-count` that accepts any request variable or header — setting it to
`$http_x_tenant_id` (or a compound expression) transparently partitions the Redis
counter per tenant.

The internal-contracts library already provides plan-level quota resolution
(`resolveTenantEffectiveCapabilities`) which is consumed by the
`scope-enforcement` plugin; the rate-limiting plugin needs access to the same
resolved `requestsPerMinute` value.

## Goals / Non-Goals

**Goals:**
- Tenant-isolated rate-limit counters at the gateway.
- Plan-driven per-tenant `requestsPerMinute` ceiling.
- Workspace-level sub-quota for workspace-bound families.
- Preserve existing `X-RateLimit-*` header emission, now per-tenant.

**Non-Goals:**
- IP-based rate limiting (separate concern).
- Per-route (fine-grained endpoint) quotas — this change operates at
  qosProfile / route-family granularity.
- Changes to the per-tenant quota data model or plan management APIs.

## Decisions

**D1 — Use `X-Tenant-Id` as the primary counter key.**
Rationale: the header is injected by the OIDC auth plugin before rate-limit
evaluation and is spoofing-resistant (`rejectSpoofedContextHeaders: true` in all
`requestValidationProfiles`). Alternative considered: deriving the key from the
JWT `sub` or an API-key hash; rejected because those require crypto operations in
the hot path.

**D2 — Resolve per-tenant limit via the existing `scope-enforcement` plugin
cache.**
Rationale: `scope-enforcement` already caches plan capability data with a
configurable TTL (`planCacheTtlSeconds`). Reusing the same cache avoids a second
lookup path and keeps the limit-resolution logic in one place. The rate-limit
plugin reads the resolved value from a shared Nginx/APISIX variable set by
`scope-enforcement`.

**D3 — Static fallback for unauthenticated / unresolvable tenants.**
Rationale: unauthenticated requests still need rate limiting to prevent DoS;
the static constant from the YAML serves as the fallback. This preserves the
current behaviour for the `/health` public route and any misconfigured client.

**D4 — Compound `X-Tenant-Id:X-Workspace-Id` key for workspace-bound families.**
Rationale: workspace-scoped families (events, storage, postgres, mongo, functions,
websockets, pg-captures, mongo-captures) have their own per-workspace quotas
defined in `workspace-sub-quota`; using a compound key lets each workspace burn
down its own sub-quota independently.

## Risks / Trade-offs

**Risk: Redis counter explosion under high-tenant-count deployments.**
Mitigation: Each tenant's counter TTL is bounded by the `requestsPerMinute`
window (60 s); Redis memory growth is `O(active_tenants × qosProfiles)`, not
unbounded. A deployment-time advisory documents the sizing.

**Risk: Plan-quota cache staleness causes stale rate limits after plan
downgrade.**
Mitigation: The `planCacheTtlSeconds` (default 30 s) bounds the window.
Operators can set it to 0 for immediate enforcement if required.

**Risk: Breaking change for tenants on restrictive plans.**
Mitigation: Documented in `proposal.md` **BREAKING** note. Deploy with a grace
period: for the first 30 days, per-tenant limits are the *maximum* of the plan
quota and the old static constant.

## Migration Plan

1. Deploy the updated `public-api-routing.yaml` with `limitKey` and
   `planQuotaSource` fields alongside the grace-period logic.
2. Monitor per-tenant 429 rates for 30 days; alert on P99 > 5 % increase.
3. After grace period, remove the static-max fallback, leaving only the
   plan-quota-driven ceiling with the static constant as a floor (not ceiling).
4. Update `scope-enforcement` plugin to expose the resolved `requestsPerMinute`
   variable for the rate-limit plugin to consume.
