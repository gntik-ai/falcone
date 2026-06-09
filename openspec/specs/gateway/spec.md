# gateway Specification

## Purpose
TBD - created by archiving change add-per-tenant-gateway-rate-limit. Update Purpose after archive.
## Requirements
### Requirement: Per-tenant rate-limit partitioning

The system SHALL partition all gateway rate-limit counters by tenant identity so
that exhausting one tenant's rate budget does not reduce the available request
quota for any other tenant.

#### Scenario: Tenant A saturation does not affect Tenant B

- **WHEN** Tenant A sends requests that exhaust its `requestsPerMinute` quota on
  the `event_gateway` qosProfile
- **THEN** subsequent requests from Tenant B on the same route class receive 200
  (or the appropriate success status) and are not throttled by Tenant A's counter

#### Scenario: Rate-limited tenant receives per-tenant 429

- **WHEN** a tenant exceeds its plan-level `requestsPerMinute` ceiling
- **THEN** the gateway responds with HTTP 429 and includes `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers scoped to that
  tenant's counter

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

### Requirement: Workspace-scoped counter for workspace-bound families

The system SHALL further partition rate-limit counters by workspace for route
families where `workspaceBinding: required`, using the compound key
`X-Tenant-Id:X-Workspace-Id`.

#### Scenario: Two workspaces under the same tenant have independent counters

- **WHEN** workspace W1 and workspace W2 (both under Tenant A) independently
  send requests on a workspace-bound route family
- **THEN** requests from W1 do not consume quota from W2's counter, and each
  workspace can independently reach its workspace-level sub-quota

#### Scenario: Workspace sub-quota exhaustion does not affect sibling workspaces

- **WHEN** workspace W1 exhausts its workspace-level rate budget
- **THEN** workspace W2 under the same tenant continues to receive 200 responses
  and its `X-RateLimit-Remaining` header is unaffected

### Requirement: Helm chart SHALL render without schema-validation errors when inline component config contains nested object or array values

The system SHALL accept `"object"` and `"array"` values — in addition to scalar types `"string"`, `"number"`, and `"boolean"` — as valid entries under any component's `config.inline` map in `charts/in-falcone/values.schema.json`, so that `helm template` and `helm lint` succeed for all default values shipped in `charts/in-falcone/values.yaml`.

The relaxation SHALL be scoped to the `config.inline.additionalProperties` type union only; all other chart schema constraints SHALL remain unchanged.

#### Scenario: Chart renders with nested-object inline config (observability metricsStack)

- **WHEN** `helm template falcone charts/in-falcone` is executed against the default `values.yaml` that sets `observability.config.inline.metricsStack` to a nested object (containing `version`, `model`, `retention`, `requiredLabels`, `tenantIsolation`, and `collectionHealth` sub-keys)
- **THEN** the command exits with code 0 and produces rendered Kubernetes manifests with no JSON-Schema validation error referencing `/observability/config/inline/metricsStack`

#### Scenario: Chart renders with nested-object inline config (webConsole auth)

- **WHEN** `helm template falcone charts/in-falcone` is executed against the default `values.yaml` that sets `webConsole.config.inline.auth` to a nested object (containing `realm`, `clientId`, `loginPath`, `signupPath`, and `passwordRecoveryPath` sub-keys)
- **THEN** the command exits with code 0 and produces rendered Kubernetes manifests with no JSON-Schema validation error referencing `/webConsole/config/inline/auth`

#### Scenario: Existing scalar inline config values remain valid

- **WHEN** `helm template falcone charts/in-falcone` is executed against values that include scalar entries under `config.inline` (e.g. `scrapeModel: platform-wide`, `publicPath: /auth`, `homepageHost: console.dev.in-falcone.example.com`)
- **THEN** the command exits with code 0 and no schema-validation error is produced for those scalar keys, confirming the relaxation is additive and does not break existing scalar inline values

#### Scenario: Chart lint passes with updated schema

- **WHEN** `helm lint charts/in-falcone` is executed after the `config.inline.additionalProperties` type union has been extended
- **THEN** the command exits with code 0 and reports no errors or warnings related to the inline config schema

