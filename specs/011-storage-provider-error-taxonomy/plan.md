# Implementation Plan: Storage Provider Error Taxonomy and Minimum Common Capabilities

**Branch**: `011-storage-provider-error-taxonomy` | **Date**: 2026-03-27 | **Spec**: `specs/011-storage-provider-error-taxonomy/spec.md`  
**Task**: US-STO-01-T05  
**Input**: Feature specification from `/specs/011-storage-provider-error-taxonomy/spec.md`

## Summary

Implement the bounded T05 storage-governance increment on top of the provider abstraction (`T01`), tenant storage context (`T02`), bucket/object CRUD surface (`T03`), and logical organization model (`T04`). This increment adds one canonical normalized storage-error taxonomy, one minimum common provider-capability baseline, structured provider capability entries with bounded constraints, additive provider/tenant introspection metadata, and observability-safe error correlation helpers.

The implementation remains additive and intentionally limited. It does **not** execute live multi-provider verification suites (`T06`), replace the existing provider abstraction, or introduce provider-specific runtime clients. It only enriches the repo’s deterministic storage helper layer, public contracts, and tests so later multi-provider execution can rely on one stable contract.

## Technical Context

**Language/Version**: Node.js 20+ ESM modules, JSON OpenAPI/contracts, Markdown docs  
**Primary Dependencies**: existing storage helpers in `services/adapters`, public contract helpers in `services/internal-contracts`, control-plane helper surface in `apps/control-plane`, and public API generation scripts  
**Storage**: no new persistence engine; deterministic helper logic models provider capability manifests, baseline validation, and normalized error shapes without live provider I/O  
**Testing**: `node:test`, public API generation/validation, OpenAPI validation, service-map validation, markdown linting  
**Target Platform**: Helm-managed Kubernetes/OpenShift deployment with public contract published from `apps/control-plane/openapi`  
**Project Type**: monorepo control-plane + adapter contracts  
**Performance Goals**: synchronous deterministic normalization and capability evaluation with stable outputs for repeated inputs  
**Constraints**: additive-only change set; preserve provider-agnostic semantics; keep tenant/workspace isolation explicit; do not leak provider-native secrets, endpoints, or raw error bodies  
**Scale/Scope**: one new storage error-taxonomy helper module, additive provider-profile and tenant-context extensions, additive service-map/OpenAPI updates, regenerated public artifacts, and focused tests

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — storage normalization and capability logic lives in `services/adapters`; public contract exposure stays in `apps/control-plane`; route/resource/service-map metadata stays in `services/internal-contracts`.
- **Incremental Delivery First**: PASS — only T05 taxonomy/baseline behavior is added.
- **Kubernetes and OpenShift Compatibility**: PASS — no runtime or deployment-specific assumptions are introduced.
- **Quality Gates at the Root**: PASS — generation, validation, and targeted test suites run from the repo root.
- **Documentation as Part of the Change**: PASS — spec/plan/tasks and regenerated docs travel with code changes.
- **No Sibling Scope Absorption**: PASS — no live multi-provider verification matrix (`T06`) or new bucket/object features are added here.

## Project Structure

### Documentation (this feature)

```text
specs/011-storage-provider-error-taxonomy/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   ├── control-plane.openapi.json                  ← additive: capability-baseline + normalized-error schemas/fields
    │   └── families/
    │       ├── storage.openapi.json                    ← regenerated
    │       └── *.openapi.json                          ← regenerated as needed
    └── src/
        └── storage-admin.mjs                           ← additive: preview/introspection helpers for normalized errors and provider capabilities

services/
├── adapters/
│   └── src/
│       ├── provider-catalog.mjs                        ← additive: export new taxonomy/baseline helper surfaces
│       ├── storage-error-taxonomy.mjs                  ← new: normalized storage error catalog, envelopes, and audit-context builders
│       ├── storage-provider-profile.mjs                ← additive: structured capability entries and baseline validation
│       ├── storage-tenant-context.mjs                  ← additive: activation gating + persisted provider capability metadata
│       ├── storage-bucket-object-ops.mjs               ← unchanged dependency for audit/context integration
│       └── storage-logical-organization.mjs            ← unchanged dependency consumed by existing bucket/object helpers
└── internal-contracts/
    └── src/
        ├── internal-service-map.json                   ← additive: capability-baseline + normalized-error responsibilities/capabilities
        ├── public-api-taxonomy.json                    ← unchanged family inventory; regenerated docs stay additive
        └── public-route-catalog.json                   ← regenerated if contract descriptions shift

tests/
├── adapters/
│   └── provider-catalog.test.mjs                       ← additive: exported capability and normalized-error helper coverage
├── contracts/
│   └── storage-provider.contract.test.mjs              ← additive: OpenAPI/service-map coverage for baseline/error schemas
└── unit/
    └── storage-admin.test.mjs                          ← additive: control-plane previews for capability baselines and normalized errors
```

## Target Architecture and Flow

### Capability-baseline flow

1. Resolve the active provider profile from `storage-provider-profile.mjs`.
2. Derive one structured capability manifest containing required baseline entries and optional extended entries.
3. Evaluate the manifest against the platform minimum baseline and produce a gap report.
4. Surface the result through provider introspection and persist it alongside the tenant storage context.
5. Block tenant storage-context activation if the provider is not baseline-eligible.

### Normalized-error flow

1. Accept provider-native error input from the storage abstraction boundary.
2. Map the provider-native code/status into exactly one normalized storage error code.
3. Emit a stable normalized error shape with HTTP-status and retryability hints.
4. Preserve only sanitized diagnostic detail in internal-only records.
5. Emit provider-agnostic audit/event context with tenant, workspace, bucket, object, operation, request, and correlation identifiers.

### Governance flow

1. `control_api` exposes the enriched provider and tenant storage introspection contract.
2. `provisioning_orchestrator` treats capability-baseline validation as a precondition for tenant storage-context activation.
3. The storage adapter service-map advertises both baseline-validation and normalized-error capabilities without binding the platform to a single provider-native contract.

## Artifact-by-Artifact Change Plan

### `services/adapters/src/storage-error-taxonomy.mjs` (new file)

Create a pure helper module that:

- defines the canonical normalized storage error catalog and retryability modes
- maps provider-native/storage-domain error aliases into stable normalized codes
- emits public-safe normalized error envelopes with correlation context
- emits internal-only sanitized diagnostic records for observability
- emits provider-agnostic normalized storage error audit events

The module remains synchronous and performs no live provider I/O.

### `services/adapters/src/storage-provider-profile.mjs`

Extend the existing provider-profile helper to:

- keep the boolean `capabilityManifest` from `T01` for backward compatibility
- add a manifest version identifier
- add structured capability entries with bounded constraints and satisfaction state
- add a minimum common capability baseline summary with eligibility, missing-capability gaps, and insufficient-capability gaps
- keep supported providers additive and baseline-eligible for the current supported set

### `services/adapters/src/storage-tenant-context.mjs`

Extend tenant storage-context generation to:

- gate activation on provider baseline eligibility in addition to existing provider readiness and entitlement checks
- persist provider capability metadata alongside the tenant context for downstream introspection
- preserve secret-safe summaries and existing quota/credential behavior
- block workspace bootstrap when the provider baseline is unsatisfied

### `services/adapters/src/provider-catalog.mjs`

Export the new storage taxonomy and capability-baseline helper surfaces so adapter consumers can access one stable catalog.

### `apps/control-plane/src/storage-admin.mjs`

Extend the storage helper surface to:

- expose provider capability-baseline/detail summaries
- expose normalized error previews, envelopes, internal records, and audit events
- preserve existing provider, tenant, bucket, and object route discoverability

### `services/internal-contracts/src/internal-service-map.json`

Additive changes only:

- extend `control_api` responsibilities to expose capability-baseline and normalized-error semantics safely
- extend `provisioning_orchestrator` responsibilities to gate storage activation on capability validation and emit normalized storage audit context
- extend the `storage` adapter port with `get_capability_details`, `validate_capability_baseline`, `normalize_storage_error`, and normalized-error event capabilities

### `apps/control-plane/openapi/control-plane.openapi.json`

Add additive schema fields only; route paths stay unchanged.

- extend `StorageProviderIntrospection` with `capabilityManifestVersion`, `capabilityDetails`, and `capabilityBaseline`
- extend `TenantStorageContext` with persisted `providerCapabilities`
- extend `TenantStorageProvisioningStatus` to allow a bounded `blocked` status for baseline failures
- add supporting schemas for capability constraints, capability entries, capability gaps, capability baselines, provider capability summaries, normalized storage errors, and normalized error envelopes

### Generated artifacts

Regenerate the route catalog, family OpenAPI slices, and reference docs with `npm run generate:public-api` so published artifacts include the enriched storage schemas.

### Tests

Add or extend coverage for:

- structured provider capability entries and baseline validation
- tenant storage-context baseline gating and persisted provider capability metadata
- normalized error mapping, retryability hints, and correlation context
- external error envelopes that do not leak provider-native URLs or secret material
- OpenAPI schemas exposing additive baseline/error fields without changing route inventory
- service-map capabilities advertising normalized-error and baseline-validation support

## Validation Plan

Run the bounded quality gates for this increment:

- `npm run generate:public-api`
- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run validate:service-map`
- `npm run lint:md`
- `npm run test:unit`
- `npm run test:adapters`
- `npm run test:contracts`

## Delivery Plan

1. Review the diff for strict T05 scope compliance.
2. Commit the `011-storage-provider-error-taxonomy` branch changes.
3. Push the branch to origin.
4. Open a PR to `main`.
5. Monitor CI, fix regressions if needed, and merge once green.

## Task Status

This plan describes the implementation and delivery work for `US-STO-01-T05`. Local execution, validation, and delivery follow the checklist in `tasks.md`.
