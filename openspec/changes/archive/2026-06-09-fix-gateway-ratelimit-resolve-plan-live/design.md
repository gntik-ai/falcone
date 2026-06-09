## Context

The `add-per-tenant-gateway-rate-limit` (#248) change added per-tenant counter
partitioning at the APISIX gateway and introduced `resolve_tenant_rate_limit` in
`scope-enforcement.lua` (lines 280–305). The resolver reads a plan quota from
`plan_rate_limit_cache` populated by `fetch_plan_requests_per_minute` (line 271).
That hook always returns `nil`, so every tenant falls through to the static YAML
floor regardless of plan tier. The per-tenant `limit-count` counters are correctly
keyed (`$http_x_tenant_id`) but all share the same ceiling, making the plan-driven
AC3 of #248 unpassable on a live stack.

The sidecar path for denial events already demonstrates the pattern: an
`resty.http` call to `SCOPE_ENFORCEMENT_SIDECAR_URL` (line 104). The plan-quota
lookup follows the same approach but uses a different endpoint and stores the
result in the dedicated `plan_rate_limit_cache` (line 11) so the hot path is
never blocked.

## Goals / Non-Goals

**Goals:**

- Wire `fetch_plan_requests_per_minute` to the live plan-quota source so that
  `ctx.var.tenant_rate_limit_rpm` reflects the tenant's plan tier on every request.
- Reuse the existing `plan_rate_limit_cache` and `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS`
  TTL — no new caching infrastructure.
- Preserve `max(planQuota, staticFloor)` semantics and the static fallback for
  unauthenticated or unresolvable requests.
- Keep `X-RateLimit-Limit` header emission consistent with the resolved ceiling.

**Non-Goals:**

- Changing the counter-key strategy (`$http_x_tenant_id` / compound workspace key)
  — that was completed in #248.
- Modifying the domain-model quota values or plan management APIs.
- IP-based or per-endpoint fine-grained rate limiting.
- Removing the grace-period `max()` ceiling — that is a separate migration step
  documented in the #248 design migration plan.

## Decisions

**D1 — Use the existing sidecar HTTP pattern for the plan-quota lookup.**
`fetch_plan_requests_per_minute` calls the control-plane plan-quota endpoint via
`resty.http` (same client already imported for denial events), with a short
per-request timeout (recommended 50–100 ms). Cache miss causes one HTTP call;
subsequent calls within TTL read from `plan_rate_limit_cache`.

**D2 — Cache key is `plan_id:metric_key`.**
This matches the existing cache-key construction in `resolve_tenant_rate_limit`
(line 288) and is already implemented — the only missing piece is a non-nil return
from `fetch_plan_requests_per_minute`.

**D3 — Static floor fallback on any error.**
`fetch_plan_requests_per_minute` returns `nil` on HTTP error, timeout, or
non-numeric response body. `resolve_tenant_rate_limit` already handles `nil` by
returning `static_floor` (line 298) — no error propagation change required.

**D4 — No new env vars beyond those already defined in #248.**
`SCOPE_ENFORCEMENT_SIDECAR_URL` and `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS` are
sufficient; the plan-quota endpoint path is a subpath of the sidecar URL or a
dedicated env var `SCOPE_ENFORCEMENT_PLAN_QUOTA_URL`.

## Risks / Trade-offs

**Risk: Sidecar latency adds to gateway hot-path P99.**
Mitigation: the `plan_rate_limit_cache` bounds live calls to one per TTL window
(default 30 s) per `plan_id`. Cache hit cost is O(1) LRU lookup. A 50 ms timeout
cap on the HTTP client ensures bounded latency degradation on sidecar failure.

**Risk: Chart does not render without `fix-gateway-chart-values-schema-inline-config`.**
Mitigation: listed as a precondition in `tasks.md`; the E2E `/e2e-issue` step will
fail-fast on chart render errors before deploying to the test cluster. This change
can be authored and validated without the chart fix — only live E2E requires it.

**Risk: Plan-quota cache staleness after plan downgrade.**
Mitigation: TTL default is 30 s; operators can set `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS=0`
for immediate enforcement if required. Documented in the #248 design.
