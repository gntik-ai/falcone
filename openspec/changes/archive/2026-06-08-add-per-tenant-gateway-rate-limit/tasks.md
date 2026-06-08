## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [x] 1.2 Confirm `openspec validate add-per-tenant-gateway-rate-limit --strict` passes

## 2. Black-box tests (write first)

- [x] 2.1 Add config-contract coverage for the two tenant tiers (free `pln_01starter` vs premium `pln_01enterprise`) via `resolveTenantEffectiveCapabilities` / `resolveTenantRateLimit` (no live APISIX in this suite — live two-tenant provisioning is `/e2e-issue` scope)
- [x] 2.2 Black-box assertion: every enabled product_api route partitions `limit-count` per tenant (`$http_x_tenant_id`, not `$consumer_name`) so one tenant's counter cannot throttle another (live 429-vs-200 partitioning is `/e2e-issue` scope)
- [x] 2.3 Black-box assertion: `X-RateLimit-Limit/Remaining/Reset` are exposed (`corsProfiles.product_api.exposeHeaders` + CORS expose_headers) so the per-tenant 429 carries them (live header emission is `/e2e-issue` scope)
- [x] 2.4 Black-box test: premium-plan `tenant.api_requests_per_minute.max` ceiling is strictly greater than free-plan (AC3) — `bbx-gw-rate-06`
- [x] 2.5 Black-box assertion: workspace-bound families key `limit-count` by the compound `$http_x_tenant_id $http_x_workspace_id` (`var_combination`) so W1 and W2 burn independent counters — `bbx-gw-rate-05` (live W1-exhaustion-vs-W2 is `/e2e-issue` scope)
- [x] 2.6 Confirmed all new tests fail before implementation (red captured: missing helper export + `undefined` qosProfile fields + `$consumer_name`/`var` keys)

## 3. Gateway config changes

- [x] 3.1 Add `limitKey: X-Tenant-Id` to all tenant-scoped qosProfiles in `services/gateway-config/base/public-api-routing.yaml`
- [x] 3.2 Add compound `limitKey: X-Tenant-Id:X-Workspace-Id` to workspace-bound qosProfiles (`provisioning`, `event_gateway`, `realtime`)
- [x] 3.3 Add `planQuotaSource: resolveTenantEffectiveCapabilities` reference field to each qosProfile
- [x] 3.4 Add grace-period fallback field `limitCeiling: max_of_plan_and_static` for initial rollout

## 4. Quota-enforcement plugin integration

- [x] 4.1 Update the `scope-enforcement` plugin to resolve and expose the per-tenant `requestsPerMinute` (`ctx.var.tenant_rate_limit_rpm`) via the reused plan-capability cache, falling back to the static YAML floor (D2/D3)
- [x] 4.2 Update the `limit-count` plugin config template (`bootstrap-payload-configmap.yaml`) + the `values.yaml` literal blocks to key per-tenant (workspace-bound: compound `var_combination`); static `count` ← `requestsPerMinute` retained as the floor
- [x] 4.3 Verify resolved per-tenant ceiling (`resolveTenantRateLimit`) is plan-driven and strictly tier-ordered; live `X-RateLimit-Limit` value check is `/e2e-issue` scope

## 5. Observability

- [x] 5.1 Confirmed `X-RateLimit-Limit/Remaining/Reset` are emitted per-tenant (present in `corsProfiles.product_api.exposeHeaders` and `cors.expose_headers`)
- [x] 5.2 Added the per-tenant rate-limit rejection series + `tenant_id`/`workspace_id` label dimensions to `gatewayPolicy.observability.gatewayMetrics`

## 6. Integration validation

- [x] 6.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass (145/145); contracts/unit/resilience green; pre-existing integration failures unrelated to this change
- [x] 6.2 Run `openspec validate add-per-tenant-gateway-rate-limit --strict`
