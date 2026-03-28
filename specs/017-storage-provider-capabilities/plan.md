# Implementation Plan: US-STO-02-T05 — Storage Provider Capability Exposure

**Feature Branch**: `017-storage-provider-capabilities`
**Spec**: `specs/017-storage-provider-capabilities/spec.md`
**Task**: US-STO-02-T05
**Epic**: EP-12 — Storage S3-compatible
**Status**: Implemented
**Created**: 2026-03-28

---

## 1. Scope Summary

This task extends the existing storage provider compatibility layer so advanced provider capabilities are exposed declaratively through the same profile/introspection surfaces that already publish baseline and optional capability metadata.

The implementation remains pure-functional and repo-local. It does not call live providers, enable advanced features, or change storage mutation behavior. It only publishes a richer, explicit capability surface for later consumers.

---

## 2. Dependency Map

| Prior task | Spec | Module | What this task consumes |
|---|---|---|---|
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | supported-provider roster, capability manifest patterns, unavailable-profile behavior |
| T05 — Error taxonomy and baseline | `011` | `storage-provider-profile.mjs`, `provider-catalog.mjs` | capability IDs, manifest versioning, compatibility summary conventions |
| T01 — Multipart/presigned | `013` | `storage-multipart-presigned.mjs` | existing optional capability publication pattern |
| T02 — Bucket policies | `014` | `storage-access-policy.mjs` | bucket-policy domain framing referenced by advanced capability exposure |
| T03 — Capacity quotas | `015` | `storage-capacity-quotas.mjs` | additive compatibility-surface style |
| T04 — Event notifications | `016` | `storage-event-notifications.mjs` | canonical `bucket.event_notifications` capability identifier already introduced by the prior task |

---

## 3. Artifact Changes

### 3.1 Primary implementation

**`services/adapters/src/storage-provider-profile.mjs`**

Planned changes:

- Extend the capability manifest template with advanced boolean summary fields:
  - `bucketPolicies`
  - `bucketLifecycle`
  - `objectLock`
  - `eventNotifications`
- Extend the optional capability catalog with:
  - `bucket.policy`
  - `bucket.lifecycle`
  - `object.lock`
  - `bucket.event_notifications`
- Reuse the existing `object.versioning` entry as part of the advanced-capability surface.
- Update provider definitions so each supported provider publishes explicit advanced capability entries, constraints, and limitations.
- Preserve unavailable-profile behavior and ensure unsupported providers still expose the full capability catalog structurally.

### 3.2 Catalog wrapper

**`services/adapters/src/provider-catalog.mjs`**

Planned changes:

- Export the additive advanced-capability data through the catalog’s existing profile/detail/baseline surfaces.
- No new route or runtime dependency is required if existing wrappers already surface the extended data shape.
- Only add wrapper exports if tests show the current exports are insufficient for downstream consumption clarity.

### 3.3 Control-plane summary compatibility

**`apps/control-plane/src/storage-admin.mjs`**

Planned changes:

- Preserve the current introspection helper APIs while ensuring they reflect the additive advanced capability fields and details through existing summaries.
- Add helper exposure only where needed for testable introspection, without changing route inventory.

### 3.4 Tests

Planned test coverage:

- **`tests/unit/storage-admin.test.mjs`**
  - confirm the control-plane summaries reflect the expanded manifest and advanced capability declarations.
- **`tests/adapters/provider-catalog.test.mjs`**
  - verify all advanced capability IDs are published for representative providers.
  - verify at least one partially supported and one unsupported advanced capability case.
- **`tests/contracts/storage-provider.contract.test.mjs`**
  - verify the additive shape remains frozen/stable and secret-safe through contract-facing helpers.

---

## 4. Technical Design

### 4.1 Capability catalog extension

Keep one unified provider-capability catalog rather than creating a parallel metadata system. Advanced capabilities will be additional optional entries inside the current capability-detail list.

This preserves:
- stable capability IDs,
- one manifest schema,
- one unavailable-profile path,
- one compatibility-summary entry point.

### 4.2 Manifest derivation

Extend `deriveBooleanManifestFromEntries()` so advanced booleans are derived from the explicit entry states instead of being hand-authored per provider.

Planned derived mappings:

- `bucketPolicies` ← `bucket.policy`
- `bucketLifecycle` ← `bucket.lifecycle`
- `objectLock` ← `object.lock`
- `eventNotifications` ← `bucket.event_notifications`
- `objectVersioning` stays mapped from `object.versioning`

This keeps boolean manifest summaries as convenience projections of the canonical entry list.

### 4.3 Provider-state modeling

Represent advanced capabilities using the existing state triad:
- `satisfied`
- `partially_satisfied`
- `unsatisfied`

Planned modeling approach:
- **MinIO**: broad advanced capability coverage, used as the representative provider with satisfied support across the new advanced capabilities.
- **Ceph RGW**: preserve at least one deployment-dependent or partial advanced capability to validate graceful degradation.
- **Garage**: preserve at least one unsupported advanced capability to validate explicit absence.

Constraints and limitations will carry the nuance instead of inventing new state values.

### 4.4 Unavailable-profile behavior

Do not special-case advanced capability output for missing or invalid provider selection. The current unavailable-profile path should continue to return a capability manifest with all booleans false and a capability-detail list containing all catalog entries in unsatisfied state.

This ensures later feature-gating code can treat unavailable selection and unsupported capability with stable structural expectations.

### 4.5 Safety and scope boundaries

This task does not:
- invoke provider-native APIs,
- validate live provider configuration,
- mutate bucket lifecycle/object lock/provider policy state,
- alter quota or event enforcement behavior.

The output is compatibility metadata only.

---

## 5. Implementation Steps

1. Extend the provider capability template and optional capability ID catalog in `storage-provider-profile.mjs`.
2. Add explicit advanced capability entries to each supported provider definition with realistic bounded summaries and constraints.
3. Add or refine provider limitations so partially supported/unsupported advanced capabilities remain explainable.
4. Confirm `buildStorageProviderProfile()`, `buildStorageCapabilityDetails()`, and unavailable-profile helpers inherit the new additive surface correctly.
5. Update `provider-catalog.mjs` and `apps/control-plane/src/storage-admin.mjs` only as needed to make the additive fields visible through current helper exports.
6. Extend unit, adapter, and contract tests for the advanced capability catalog and manifest fields.
7. Run targeted storage tests, then the full repository test suite.

---

## 6. Validation Plan

Targeted commands:

```bash
node --test tests/unit/storage-admin.test.mjs
node --test tests/adapters/provider-catalog.test.mjs
node --test tests/contracts/storage-provider.contract.test.mjs
```

Broader gate:

```bash
npm test
```

Optional if required by touched artifacts:

```bash
npm run lint:md
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
npm run validate:service-map
```

---

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider support is overstated | Later features may incorrectly enable advanced flows | Encode nuance through `partially_satisfied`, constraints, and limitation summaries |
| Advanced booleans drift from detail entries | Inconsistent introspection output | Keep booleans derived from the canonical entry list only |
| Existing helper consumers expect the old manifest shape | Additive breakage in tests or summaries | Extend tests first and preserve all existing fields unchanged |
| Unavailable-profile handling misses new capability IDs | Feature-gating consumers face missing fields | Reuse the existing capability-catalog generator for both ready and unavailable profiles |

---

## 8. Definition of Done

- Advanced capability IDs are present in the provider capability catalog and detail output.
- Manifest booleans include the new advanced fields.
- Supported providers publish explicit advanced capability states, summaries, and constraints.
- Unavailable selection continues to expose a stable unsupported capability surface.
- Unit, adapter, and contract tests pass.
- Full repository test suite passes.
