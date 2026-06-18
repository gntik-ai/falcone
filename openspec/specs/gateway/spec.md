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

### Requirement: Gateway exposes an MCP inbound route
The gateway SHALL define an MCP inbound route (an APISIX route declaration, consistent with how other non-control-plane surfaces are declared — e.g. `routes/backup-admin-routes.yaml`) that terminates Streamable HTTP, applies OAuth 2.1 token validation and scope enforcement (reusing the platform `keycloak-openid-connect` + `scope-enforcement` plugins), and proxies to tenant MCP-server workloads — without disrupting the existing gateway-policy family contracts.

#### Scenario: MCP route does not break gateway-policy contracts
- **WHEN** the gateway policy contracts are validated
- **THEN** the MCP inbound route is present and the existing gateway-policy family/route consistency checks still pass with no violations

#### Scenario: MCP route uses OAuth + scope enforcement and SSE-friendly upstream
- **WHEN** the MCP route handles a request
- **THEN** it validates the OAuth 2.1 token and enforces the MCP scope before proxying, over a Streamable-HTTP-friendly upstream (long read timeout, response buffering disabled)

### Requirement: Gateway MUST authenticate every data-plane request

The system SHALL require a valid credential (verified JWT or API key) on every public data-plane route at the gateway, and SHALL reject any request that presents no credential with HTTP 401, even when the request carries client-supplied tenant-context headers.

#### Scenario: Unauthenticated request with spoofed tenant header is rejected at the gateway

- **WHEN** a client sends `POST /v1/workspaces/<A_ws>/api-keys` through the gateway with header `x-tenant-id: <A_tenant>` and no `Authorization` header
- **THEN** the gateway returns HTTP 401 and no API key is minted for any tenant

#### Scenario: Valid credential is accepted

- **WHEN** a client sends a data-plane request bearing a valid JWT or API key
- **THEN** the gateway forwards the request and the backend responds with the appropriate success status

### Requirement: Gateway MUST strip client-supplied tenant-context headers

The system SHALL strip inbound `x-tenant-id`, `x-workspace-id`, and `x-auth-subject` headers from client requests at the gateway and SHALL re-inject tenant context only from the verified token claims, so that a client-controlled header can never establish or override tenant identity at the backend.

#### Scenario: Client tenant headers never reach the backend

- **WHEN** an authenticated client sends a request that includes a forged `x-tenant-id` header for another tenant
- **THEN** the gateway discards the client header and the backend receives only the tenant identity derived from the verified credential

### Requirement: Advertised public routes MUST match the runtime

The system SHALL ensure that every route published in the public OpenAPI catalog either responds at runtime or is removed from the catalog, so that no advertised route returns `NO_ROUTE`.

#### Scenario: An advertised route responds or is not advertised

- **WHEN** a client calls any route present in the published OpenAPI catalog
- **THEN** the route responds (success or a defined error) and does not return `NO_ROUTE`

#### Scenario: Catalog and runtime are in parity

- **WHEN** the published catalog is compared against the live runtime routes
- **THEN** there are no advertised routes that are unimplemented at runtime

### Requirement: Console same-origin API calls MUST be edge-routable

The system SHALL provide an edge (ingress controller and routes, or equivalent) in the deployed topology that routes the console host's same-origin `/v1/*` requests to the control-plane/gateway, so a browser receives API responses rather than the SPA HTML fallback.

#### Scenario: Console reaches the API end-to-end

- **WHEN** a browser on the console host issues a same-origin `/v1/*` API request
- **THEN** the request is routed to the control-plane and returns an API (JSON) response, not the SPA HTML fallback

### Requirement: GATEWAY_SHARED_SECRET is provisioned and consistent across components

The system SHALL ensure that the `GATEWAY_SHARED_SECRET` environment variable is
available to the APISIX gateway process and to the executor on every installation,
sourced from a chart-managed Kubernetes Secret.

The secret value MUST be generated (or accepted as an override) at install time and
MUST NOT be left unset, causing a startup crash.

#### Scenario: APISIX starts without CrashLoopBackOff

- **WHEN** the Helm chart is installed without a pre-existing `GATEWAY_SHARED_SECRET`
- **THEN** the chart MUST generate and provision the secret automatically; APISIX MUST
  reach the `Running` state without a crash

#### Scenario: Executor enforces gateway trust using the shared secret

- **WHEN** the executor receives a request that must pass the gateway-trust check
- **THEN** the executor MUST validate the request against `GATEWAY_SHARED_SECRET`
  and reject requests that do not carry a valid gateway signature

### Requirement: Gateway exposes no /v1/flows or /v1/mcp routes

The system SHALL ensure that gateway exposes no /v1/flows or /v1/mcp routes is corrected: Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** `GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway

