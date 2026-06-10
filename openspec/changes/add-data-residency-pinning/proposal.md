## Why

Data residency is **modeled in the deployment topology contract but hard-pinned to a
single region with no per-tenant control or enforcement**. In
`services/internal-contracts/src/deployment-topology.json` every environment profile
(`dev`, `sandbox`, `staging`, `prod`) carries `topology.region_mode: "single_region"`
and `topology.region_ref: "eu-west-1"` (lines 112-117, 142-147, 172-177, 203-208).
Multi-region support appears only under `future_topology.evolution_targets`
(`["multi_cluster", "multi_region"]`, line 237), with a routing rule noting that
"DNS and gateway policy may shift traffic between clusters or regions without changing
public URI prefixes or tenant-visible hostnames" (line 240). The
`future_topology.compatibility_contract.placement_metadata` field already reserves
`["environment_id", "cluster_ref", "region_ref"]` (lines 229-233) as first-class
placement dimensions — so the schema explicitly anticipates multi-region placement but
has not implemented it.

Critically, the provisioning appliers
(`services/provisioning-orchestrator/src/appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs`)
accept no `regionRef` or `residencyRegion` parameter: every tenant's IAM realm,
Kafka topics, Postgres schema, MongoDB collection, storage namespace, and OpenWhisk
namespace is provisioned into the single hard-coded region. There is no tenant
attribute selecting a region, no enforcement that a tenant's data stays in a chosen
jurisdiction, and no audit event fired when a request would cross the boundary.

For a multitenant BaaS serving regulated workloads (GDPR, HIPAA, DPDP), the
inability to pin a tenant's data to a jurisdiction is a compliance gap that blocks
entire customer segments.

## What Changes

- Add a `dataResidency.region` attribute to the tenant provisioning input, validated
  against the set of available `region_ref` values declared in
  `deployment-topology.json`, so each tenant can declare its residency region at
  create time and (with appropriate constraints) update it.
- Thread the resolved `regionRef` through every provisioning applier
  (`iam-applier.mjs`, `kafka-applier.mjs`, `postgres-applier.mjs`,
  `mongo-applier.mjs`, `storage-applier.mjs`, `functions-applier.mjs`) so resources
  are provisioned in the tenant's pinned region rather than the platform default.
- Persist `dataResidency.region` on the tenant record and surface it on the
  tenant management APIs (`/v1/admin/tenants/{tenantId}`,
  `apps/control-plane/src/tenant-management.mjs`).
- Implement a gateway / control-plane enforcement check: if a request would place or
  retrieve data in a region other than the tenant's pinned region, reject it and emit
  a `residency_violation` audit event carrying `tenantId`, `requestedRegion`,
  `pinnedRegion`, and request context.
- Expose region availability via the platform topology endpoint so tenants can
  discover which regions are available before provisioning.

## Capabilities

### New Capabilities

- `data-residency`: Per-tenant `dataResidency.region` pinning resolved at provisioning and threaded through all appliers; gateway enforcement that rejects cross-region requests; `residency_violation` audit events for boundary-crossing attempts; region-availability discovery surface.

### Modified Capabilities

## Impact

- `services/internal-contracts/src/deployment-topology.json` — promote `placement_metadata.region_ref` from a compatibility note to a first-class constraint; add a `supported_regions` catalog.
- `services/provisioning-orchestrator/src/appliers/iam-applier.mjs` — accept `regionRef` parameter; route Keycloak realm creation to the regional cluster.
- `services/provisioning-orchestrator/src/appliers/kafka-applier.mjs` — accept `regionRef`; select the regional Kafka broker set.
- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` — accept `regionRef`; use the regional PG cluster.
- `services/provisioning-orchestrator/src/appliers/mongo-applier.mjs` — accept `regionRef`; use the regional MongoDB cluster.
- `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` — accept `regionRef`; bucket/namespace placement in the pinned region.
- `services/provisioning-orchestrator/src/appliers/functions-applier.mjs` — accept `regionRef`; OpenWhisk namespace in the pinned region.
- `apps/control-plane/src/tenant-management.mjs` — persist and expose `dataResidency.region` on tenant create/read; new route `GET /v1/platform/topology/regions`.
- New audit event category `residency_violation` in `services/internal-contracts/src/observability-audit-pipeline.json`.
