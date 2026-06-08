## Why

Gateway rate-limit counters are shared across all tenants: every `qosProfile` in
`services/gateway-config/base/public-api-routing.yaml` (lines 136–190) defines
`requestsPerMinute`/`burst` as flat, global counters with no `limitKey`, `keyBy`,
or `byTenant` dimension. A single abusive tenant can exhaust the shared budget
and trigger 429s for every other tenant on the same route class — a classic
noisy-neighbour / quota-isolation failure (audit priority #4).

The per-tenant budget data already exists: `services/internal-contracts/src/index.mjs::buildCapabilityResolution`
assembles plan-level `quotas[]` with `enforcementMode` per capability, and
`resolveTenantEffectiveCapabilities` resolves the correct limit for a given
tenant. This data is never wired into gateway rate limiting.

## What Changes

- Extend each `qosProfile` in `public-api-routing.yaml` with a `limitKey` field
  (`X-Tenant-Id` for tenant-scoped families; `X-Tenant-Id:X-Workspace-Id` for
  workspace-scoped families) so the APISIX `limit-count`/`limit-req` plugin
  partitions counters per tenant (and optionally per workspace).
- Add a `planQuotaSource` field to each profile so the gateway's quota-enforcement
  plugin resolves the per-tenant `requestsPerMinute` ceiling from
  `resolveTenantEffectiveCapabilities` output rather than from the static constant
  in the YAML.
- Keep the static constant as a default / fallback for unauthenticated or
  unrecognised tenants.
- Emit the existing `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` headers (already declared in `corsProfiles.product_api.exposeHeaders`)
  scoped to the per-tenant counter, not the global one.
- **BREAKING:** a tenant that previously shared a global budget now has its own
  budget equal to the plan quota; tenants on restrictive plans will see lower
  effective limits than before the change.

## Capabilities

### New Capabilities

- `gateway`: Per-tenant rate-limit partitioning at the APISIX gateway layer; each tenant's counter is isolated so one tenant's 429 never affects another's budget.

### Modified Capabilities

## Impact

- `services/gateway-config/base/public-api-routing.yaml::qosProfiles` — add `limitKey` and `planQuotaSource` to all nine profiles.
- `services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities` — consumed by the gateway quota-enforcement plugin to supply per-tenant `requestsPerMinute`.
- `services/internal-contracts/src/index.mjs::buildCapabilityResolution` — `quotas[]` with `enforcementMode` is the upstream source of plan limits.
- All `/v1/*` routes observe per-tenant 429 behavior; no new routes added.
