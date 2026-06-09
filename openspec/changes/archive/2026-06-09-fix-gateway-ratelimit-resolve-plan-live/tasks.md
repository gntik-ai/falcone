## 1. Baseline

- [x] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [x] T02 Confirm `openspec validate fix-gateway-ratelimit-resolve-plan-live --strict` passes

## 2. Black-box tests (write first — red before implementation)

- [x] T03 Tier ordering at the contracts layer (`resolveTenantRateLimit` enterprise=2400 > starter=120, floor honoured) is covered by the existing runnable JS black-box test `tests/blackbox/gateway-per-tenant-rate-limit.test.mjs` (node --test). No live APISIX needed.
- [x] T04 The Lua live-resolution behaviour (a numeric plan quota makes `resolve_tenant_rate_limit` / `ctx.var.tenant_rate_limit_rpm` reflect the plan ceiling, not the static floor) is covered by the new busted spec `services/gateway-config/tests/plugins/scope-enforcement-plan-rate-limit.spec.lua`. NOTE: no lua/busted runner is available in this environment (not root, no luarocks; E2E blocked), so the busted spec is authored and verified by inspection and is intended to run in the gateway-config Lua test pipeline / CI.
- [x] T05 The error/timeout path (`fetch_plan_requests_per_minute` returns nil → `resolve_tenant_rate_limit` falls back to the static floor, no error raised) is covered by the busted spec's "fall back to static floor" and "transport error (fail closed)" cases.
- [x] T06 Red captured by inspection: against the old `fetch_plan_requests_per_minute` stub (always `nil`), the busted spec's "resolve returns the live plan ceiling" case would assert 2400 but get the static floor → fails; it passes only with the implemented HTTP lookup.

## 3. Lua implementation

- [x] T07 Implemented `fetch_plan_requests_per_minute(plan_id, metric_key)` in `services/gateway-config/plugins/scope-enforcement.lua`: HTTP GET to `SCOPE_ENFORCEMENT_PLAN_QUOTA_URL` (or derived from `SCOPE_ENFORCEMENT_SIDECAR_URL` by swapping `/denials`→`/plan-quota`) with `plan_id`/`metric_key` query params; parses JSON for the numeric ceiling (`requests_per_minute`/`value`/`limit`); returns `nil` on any error/non-200/parse failure (pcall-wrapped, configurable timeout, default 200 ms).
- [x] T08 Caching is performed by `resolve_tenant_rate_limit` (`plan_rate_limit_cache:get/set` keyed `plan_id .. ":" .. metric_key`, TTL `plan_rate_cache_ttl_seconds()`); the non-nil return from T07 activates it. No additional code needed. (Busted spec asserts the second call is served from cache without refetch.)
- [x] T09 `ctx.var.tenant_rate_limit_rpm` is set from `resolve_tenant_rate_limit` in `_M.access` (lines 399–401); confirmed already wired — the live fetch now feeds it the plan ceiling.

## 4. Integration validation

- [x] T10 `bash tests/blackbox/run.sh` — 145/145 pass (JS contract + no regression; Lua not loaded by node --test).
- [x] T11 `openspec validate fix-gateway-ratelimit-resolve-plan-live --strict` passes.

## 5. Live E2E (precondition: `fix-gateway-chart-values-schema-inline-config` merged)

- [~] T12 DEFERRED — precondition: gateway chart must render; E2E is currently blocked in this environment.
- [~] T13 DEFERRED — `bash tests/e2e/run-issue.sh ...` requires the live test cluster (E2E blocked); the busted spec + JS contract test cover the behaviour at unit level.
- [~] T14 DEFERRED — unauthenticated/static-floor live assertion requires E2E.
