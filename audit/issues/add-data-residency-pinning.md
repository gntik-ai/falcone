# Per-tenant region / data-residency pinning & enforcement

| Field | Value |
|---|---|
| **Change ID** | `add-data-residency-pinning` |
| **Capability** | `data-residency` |
| **Type** | enhancement |
| **Priority** | P2 |
| **OpenSpec change** | `openspec/changes/add-data-residency-pinning/` |

---

## Why

Data residency is **modeled in the deployment topology contract but hard-pinned to a single region with no per-tenant control or enforcement**. In `services/internal-contracts/src/deployment-topology.json`, every environment profile (`dev`, `sandbox`, `staging`, `prod`) carries `topology.region_mode: "single_region"` and `topology.region_ref: "eu-west-1"` (dev: line 112-117, sandbox: 142-147, staging: 172-177, prod: 203-208). Multi-region appears only as a `future_topology.evolution_targets` entry (`"multi_region"`, line 237) with a routing note (line 240). The `future_topology.compatibility_contract.placement_metadata` field already reserves `["environment_id", "cluster_ref", "region_ref"]` (lines 229-233) — the schema explicitly anticipates per-tenant placement but has not implemented it.

The six provisioning appliers (`services/provisioning-orchestrator/src/appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs`) accept no `regionRef` parameter: every tenant's IAM realm, Kafka topics, Postgres schema, MongoDB namespace, storage namespace, and function namespace is provisioned into the single hard-coded cluster. There is no tenant attribute selecting a region and no enforcement that a tenant's data stays in a chosen jurisdiction.

For a multitenant BaaS serving regulated workloads (GDPR, HIPAA, DPDP), the inability to pin a tenant's data to a jurisdiction blocks entire customer segments and is a compliance gap (audit priorities #5-#6).

## What Changes

- Add `dataResidency.region` as a provisioning-time tenant attribute, validated against a `supported_regions` catalog derived from `deployment-topology.json`.
- Persist `data_residency_region` on the tenant record and return it on tenant GET.
- Thread the resolved `regionRef` through all six provisioning appliers so tenant resources are placed in the pinned region.
- Add `GET /v1/platform/topology/regions` endpoint returning the supported-regions catalog.
- Implement a control-plane enforcement check: requests that would cross the tenant's pinned-region boundary are rejected (403) and emit a `residency_violation` audit event with `tenantId`, `pinnedRegion`, and `requestedRegion`.
- Add `residency_violation` as a new audit category in `services/internal-contracts/src/observability-audit-pipeline.json`.

## Spec delta (EARS)

- The system **SHALL** allow a `dataResidency.region` attribute to be specified at tenant provisioning time, validated against the platform's supported-regions catalog; an invalid region **MUST** be rejected with a 400-class error.
- The system **SHALL** persist `dataResidency.region` on the tenant record and return it on tenant GET; the attribute **SHALL** be immutable after provisioning in the initial implementation.
- The system **SHALL** thread the resolved `regionRef` through all six provisioning appliers so IAM realm, Kafka topics, Postgres schema, MongoDB namespace, storage namespace, and function namespace are placed in the tenant's pinned region.
- The system **SHALL** reject any request that would place or retrieve a tenant's data in a region other than the tenant's `dataResidency.region` with a 403-class response and emit a `residency_violation` audit event carrying `tenantId`, `pinnedRegion`, and `requestedRegion`.
- The system **SHALL** expose the set of valid region identifiers at `GET /v1/platform/topology/regions`; the list **MUST** reflect the distinct `region_ref` values declared in `deployment-topology.json`.

Full spec: `openspec/changes/add-data-residency-pinning/specs/data-residency/spec.md`

## Tasks

See `openspec/changes/add-data-residency-pinning/tasks.md` for the full checklist. Key groups:

1. Baseline — confirm green before starting
2. Black-box tests (write-first): region CRUD on tenant, invalid-region rejection, per-tenant isolation, applier receives `regionRef`, cross-region 403 + audit event, topology endpoint
3. Topology contract update — `supported_regions` catalog + `getSupportedRegions()` helper
4. Database migration — `data_residency_region TEXT` column on tenants table
5. Tenant management API — accept/persist/return `dataResidency.region`; regions discovery endpoint
6. Applier threading — all six appliers accept `regionRef`; saga passes tenant's region
7. Residency enforcement — middleware, 403 response, `residency_violation` audit event, no-op for null region
8. Integration validation — `bash tests/blackbox/run.sh`

## Acceptance criteria

- Tenant created with `dataResidency.region: "eu-west-1"` persists and GET returns the value.
- Tenant created with an unsupported region is rejected with a 400-class error; no tenant record is created.
- Tenant A's region does not appear on Tenant B's record.
- All six applier invocations during provisioning carry the tenant's `regionRef`.
- A request targeting the tenant's pinned region succeeds; a request crossing the boundary returns 403 with a `RESIDENCY_VIOLATION` code.
- A cross-region request emits a `residency_violation` audit event with correct `tenantId`, `pinnedRegion`, and `requestedRegion`.
- `GET /v1/platform/topology/regions` returns the catalog of supported region identifiers matching `deployment-topology.json`.

## Code evidence

- `services/internal-contracts/src/deployment-topology.json:112-117,142-147,172-177,203-208` — every environment profile: `region_mode: "single_region"`, `region_ref: "eu-west-1"`; no per-tenant region field.
- `services/internal-contracts/src/deployment-topology.json:229-233` — `future_topology.compatibility_contract.placement_metadata: ["environment_id", "cluster_ref", "region_ref"]` — region_ref reserved as a first-class dimension but not yet used.
- `services/internal-contracts/src/deployment-topology.json:237` — `future_topology.evolution_targets: ["multi_cluster", "multi_region"]` — explicitly aspirational.
- `services/provisioning-orchestrator/src/appliers/iam-applier.mjs` — no `regionRef` parameter in function signature.
- `services/provisioning-orchestrator/src/appliers/kafka-applier.mjs` — no `regionRef` parameter.
- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` — no `regionRef` parameter.
- `services/provisioning-orchestrator/src/appliers/mongo-applier.mjs` — no `regionRef` parameter.
- `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` — no `regionRef` parameter.
- `services/provisioning-orchestrator/src/appliers/functions-applier.mjs` — no `regionRef` parameter.
- `apps/control-plane/src/tenant-management.mjs` — tenant create/read; no `dataResidency.region` field.

## Resolution (OpenSpec)

```
/opsx:apply add-data-residency-pinning
/opsx:verify add-data-residency-pinning
bash tests/blackbox/run.sh
/opsx:archive add-data-residency-pinning
```

Or use the wrapper: `/implement-change add-data-residency-pinning`

Optional real-stack E2E: `/e2e-issue add-data-residency-pinning`
