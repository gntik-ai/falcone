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
from the tenant's active plan quotas (via `resolveTenantEffectiveCapabilities`)
rather than from a static constant, so that premium-plan tenants receive a higher
throughput allowance than free-plan tenants.

#### Scenario: Premium-plan tenant receives higher limit than free-plan tenant

- **WHEN** a premium-plan tenant and a free-plan tenant both authenticate and
  call the same `/v1/*` route family
- **THEN** the `X-RateLimit-Limit` header value for the premium-plan tenant is
  strictly greater than that for the free-plan tenant

#### Scenario: Fallback to static default for unauthenticated requests

- **WHEN** a request arrives without a recognised tenant identity (no valid
  `X-Tenant-Id` header or unresolvable plan)
- **THEN** the gateway applies the static default `requestsPerMinute` from the
  qosProfile YAML and does not error

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

