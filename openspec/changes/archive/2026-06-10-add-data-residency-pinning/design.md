## Context

The Falcone deployment topology contract
(`services/internal-contracts/src/deployment-topology.json`) already models
`topology.region_ref` on every environment profile and reserves
`placement_metadata: ["environment_id", "cluster_ref", "region_ref"]` in the
`future_topology.compatibility_contract` section. Every current profile is set to
`region_mode: "single_region"` with `region_ref: "eu-west-1"`, making multi-region
placement an aspiration rather than an active capability.

The six provisioning appliers under
`services/provisioning-orchestrator/src/appliers/` each create tenant resources in
their respective backends but accept no region parameter — all resources land in
whatever cluster or endpoint the applier is statically configured to use. This
change makes region an explicit, per-tenant, first-class input to the provisioning
saga.

## Goals / Non-Goals

**Goals:**
- Add `dataResidency.region` as a required-at-provisioning tenant attribute.
- Validate the attribute against a platform-provided supported-regions catalog
  derived from `deployment-topology.json`.
- Pass `regionRef` through all six provisioning appliers.
- Persist `dataResidency.region` on the tenant record and expose it via the tenant
  management API.
- Implement cross-region request enforcement with `residency_violation` audit events.
- Add `GET /v1/platform/topology/regions` discovery endpoint.

**Non-Goals:**
- Implementing live data migration between regions (out of scope; requires a
  separate migration saga).
- Supporting multiple simultaneous residency regions for a single tenant (single
  pinned region only in this change).
- Changing the Helm chart topology to actually deploy multi-region infrastructure
  (this change enables the software behavior; infrastructure deployment is a separate
  concern).

## Decisions

**D1 — Derive supported regions from `deployment-topology.json` at runtime.**
Rationale: `deployment-topology.json` is the authoritative source of deployed
topology. Deriving the catalog from it avoids a secondary configuration surface and
ensures the supported-regions list is always consistent with what is actually
deployed.
Alternative: Hard-code a regions list in the control plane — rejected because it
would diverge from the topology contract.

**D2 — `dataResidency.region` is immutable after provisioning (initial version).**
Rationale: Moving a tenant's data between regions is a destructive, multi-step
migration that requires a separate saga (data copy + DNS cut-over + applier
teardown). Making the field immutable after provisioning avoids an unimplemented
code path and keeps the initial change focused. A future change can implement the
migration path.

**D3 — `residency_violation` is a new audit event category, not reusing an existing
one.**
Rationale: The violation is distinct from an authorization denial
(`capability_enforcement_denied`) — it is a topology boundary crossing, not a
permissions failure. A dedicated category allows compliance queries to distinguish
residency events from authz events.

**D4 — Appliers receive `regionRef` as an explicit parameter, not via environment
variable.**
Rationale: Passing `regionRef` explicitly through the saga input makes the
provisioning flow deterministic and testable. Environment-variable injection would
make it impossible to test multi-region behavior in a single-region test environment.

## Risks / Trade-offs

**Risk: In single-region deployments (all current profiles), the region catalog
contains only one entry and all tenants must pin to the same region.**
Mitigation: This is correct behavior for single-region deployments. The catalog
endpoint returns the one available region; provisioning still requires an explicit
selection. Future multi-region profiles expand the catalog without breaking the
existing contract.

**Risk: Applier changes are broad (six files) and any missed parameter thread
leaves a resource in the wrong region silently.**
Mitigation: Integration tests for each applier assert that the `regionRef` passed
to the applier matches the resource placement metadata returned. The `residency_violation`
enforcement provides a runtime backstop.

**Risk: Residency enforcement at the control-plane layer does not cover direct
backend calls that bypass the API.**
Mitigation: This is documented as an operational constraint. Residency enforcement
at the data-plane level (e.g. Postgres RLS region column, Kafka topic region tag)
is a follow-on hardening step.

**Risk: The `deployment-topology.json` `region_mode: "single_region"` field may
block the feature from being exercised in tests.**
Mitigation: Test fixtures use an override that exposes two virtual regions (e.g.
`eu-west-1` and `us-east-1`) via the supported-regions catalog, exercising the full
validation and enforcement paths without requiring real multi-region infrastructure.

## Migration Plan

1. Extend `deployment-topology.json` to add a top-level `supported_regions` catalog
   array derived from all distinct `region_ref` values across environment profiles.
2. Add a new migration (e.g. `services/provisioning-orchestrator/src/migrations/091-tenant-data-residency.sql`)
   adding a `data_residency_region TEXT` column to the tenants table.
3. Update `apps/control-plane/src/tenant-management.mjs`:
   - Accept `dataResidency.region` on tenant create; validate against catalog.
   - Persist `data_residency_region`; return on GET.
   - Add `GET /v1/platform/topology/regions` endpoint.
4. Update each applier in `services/provisioning-orchestrator/src/appliers/` to
   accept and use `regionRef`.
5. Add `residency_violation` category to
   `services/internal-contracts/src/observability-audit-pipeline.json`.
6. Implement enforcement middleware/guard in the control-plane request handler.
7. Run `bash tests/blackbox/run.sh` to confirm no regressions.
