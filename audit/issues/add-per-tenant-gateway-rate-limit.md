# Per-tenant / per-workspace rate-limit partitioning at the gateway

| Field | Value |
|-------|-------|
| Change ID | `add-per-tenant-gateway-rate-limit` |
| Capability | `gateway`, `quotas-plans` |
| Type | enhancement |
| Priority | P0 |
| OpenSpec change | `openspec/changes/add-per-tenant-gateway-rate-limit/` |

## Why

Gateway rate-limit counters are global, not per-tenant. Every `qosProfile` in
`services/gateway-config/base/public-api-routing.yaml` (lines 136–190) defines
`requestsPerMinute`/`burst` as flat counters with no `limitKey`, `keyBy`, or
`byTenant` dimension. A single abusive or noisy tenant can exhaust the shared
budget and cause 429s for every other tenant on the same route class — a
noisy-neighbour / quota-isolation failure (audit priority #4).

Per-tenant plan quota data already exists in
`services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities`
(quota dimensions with `enforcementMode`) but it is never wired into gateway rate
limiting.

## What Changes

- Extend each `qosProfile` with a `limitKey` field (`X-Tenant-Id` for
  tenant-scoped families; `X-Tenant-Id:X-Workspace-Id` for workspace-scoped
  families) so the APISIX `limit-count`/`limit-req` plugin partitions counters
  per tenant.
- Add a `planQuotaSource` reference so the gateway quota-enforcement plugin
  resolves the per-tenant `requestsPerMinute` ceiling from
  `resolveTenantEffectiveCapabilities` rather than from a static YAML constant.
- Keep the static constant as a floor / fallback for unauthenticated requests.
- Emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
  (already in `corsProfiles.product_api.exposeHeaders`) scoped to the per-tenant
  counter.
- **BREAKING:** tenants on restrictive plans will see lower effective limits than
  the current global static; a grace-period ceiling (`max_of_plan_and_static`)
  is deployed first.

## Spec delta (EARS)

From `openspec/changes/add-per-tenant-gateway-rate-limit/specs/gateway/spec.md`:

**REQ — Per-tenant rate-limit partitioning**
The system SHALL partition all gateway rate-limit counters by tenant identity so
that exhausting one tenant's rate budget does not reduce the available request
quota for any other tenant.

**REQ — Plan-quota-driven rate limit ceiling**
The system SHALL resolve each tenant's effective `requestsPerMinute` ceiling from
the tenant's active plan quotas (`resolveTenantEffectiveCapabilities`) rather than
from a static constant.

**REQ — Workspace-scoped counter for workspace-bound families**
The system SHALL further partition rate-limit counters by workspace for route
families where `workspaceBinding: required`, using the compound key
`X-Tenant-Id:X-Workspace-Id`.

## Tasks

See `openspec/changes/add-per-tenant-gateway-rate-limit/tasks.md` for the full
checklist. Key groups:

1. Baseline green
2. Black-box tests (write first — red before green)
3. Gateway config changes (`limitKey`, `planQuotaSource` fields in all qosProfiles)
4. Quota-enforcement plugin integration (scope-enforcement exposes resolved limit)
5. Observability (per-tenant `X-RateLimit-*` headers; Prometheus label)
6. Final `bash tests/blackbox/run.sh`

## Acceptance criteria

- **AC1:** Tenant A exhausting its `requestsPerMinute` budget on the
  `event_gateway` profile results in HTTP 429 for Tenant A; concurrent requests
  from Tenant B on the same route class succeed with 200.
- **AC2:** 429 response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  and `X-RateLimit-Reset` headers reflecting the per-tenant counter.
- **AC3:** `X-RateLimit-Limit` for a premium-plan tenant is strictly greater than
  for a free-plan tenant on the same route family.
- **AC4:** Workspace W1 exhausting its workspace-level quota does not affect
  sibling workspace W2 under the same tenant (workspace-bound family).
- **AC5:** Unauthenticated or plan-unresolvable requests fall back to the static
  default limit without error.
- **AC6:** `bash tests/blackbox/run.sh` passes green.

## Code evidence

- `services/gateway-config/base/public-api-routing.yaml::qosProfiles` (lines 136–190) — nine profiles, none with `limitKey`/`keyBy`/`byTenant`
- `services/gateway-config/base/public-api-routing.yaml::corsProfiles.product_api.exposeHeaders` (lines 460–464) — `X-RateLimit-*` headers already exposed
- `services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities` — per-tenant plan quota resolution (unused by gateway rate limiting)
- `services/internal-contracts/src/index.mjs::buildCapabilityResolution` — assembles `quotas[]` with `enforcementMode` per capability

## Resolution (OpenSpec)

```
/opsx:apply add-per-tenant-gateway-rate-limit
/opsx:verify add-per-tenant-gateway-rate-limit
bash tests/blackbox/run.sh
/opsx:archive add-per-tenant-gateway-rate-limit
```

Alternatively: `/implement-change add-per-tenant-gateway-rate-limit`

Optional real-stack E2E: `/e2e-issue add-per-tenant-gateway-rate-limit`
