# Tasks: US-STO-02-T05 — Storage Provider Capability Exposure

**Input**: `specs/017-storage-provider-capabilities/spec.md`, `specs/017-storage-provider-capabilities/plan.md`  
**Feature Branch**: `017-storage-provider-capabilities`

## Phase 1 — Capability catalog extension

- [x] T001 Extend the storage provider capability manifest template and capability-ID catalog in `services/adapters/src/storage-provider-profile.mjs` to cover `bucket.policy`, `bucket.lifecycle`, `object.lock`, and `bucket.event_notifications` alongside `object.versioning`.
- [x] T002 Derive additive manifest booleans for bucket policies, lifecycle, object lock, and event notifications from the canonical capability-entry list in `services/adapters/src/storage-provider-profile.mjs`.
- [x] T003 Update supported provider definitions in `services/adapters/src/storage-provider-profile.mjs` so MinIO, Ceph RGW, and Garage publish explicit advanced capability states, summaries, constraints, and limitations.

## Phase 2 — Introspection and compatibility surfaces

- [x] T004 Confirm the existing provider profile, capability details, and unavailable-profile builders in `services/adapters/src/storage-provider-profile.mjs` expose the extended advanced capability surface additively.
- [x] T005 Update `services/adapters/src/provider-catalog.mjs` only as needed so catalog consumers can access the additive advanced capability publication through existing exports.
- [x] T006 Update `apps/control-plane/src/storage-admin.mjs` only as needed so provider introspection helpers surface the extended manifest/details without changing route inventory.

## Phase 3 — Verification

- [x] T007 Extend `tests/adapters/provider-catalog.test.mjs` with assertions for the new advanced capability IDs, manifest booleans, and representative partial/unsupported provider states.
- [x] T008 Extend `tests/unit/storage-admin.test.mjs` with assertions for the additive advanced capability exposure in storage provider summaries and introspection.
- [x] T009 Extend `tests/contracts/storage-provider.contract.test.mjs` with additive contract assertions for the advanced capability publication surface.
- [x] T010 Run targeted verification for the touched storage provider surfaces and then run `npm test`; fix any regressions before completion.
