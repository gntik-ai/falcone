# Implementation Plan: US-OBS-03-T06 — Cross-Module Incremental Consumption and Quota Enforcement Verification

**Feature Branch**: `042-quota-enforcement-verification`
**Spec**: `specs/042-quota-enforcement-verification/spec.md`
**Task**: `US-OBS-03-T06`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T06` closes the story by delivering one bounded **cross-module verification matrix**
that proves the previously-delivered observability/quota baselines remain aligned across real module
families.

The increment must prove, in automated tests only, that:

- usage can be represented as a deterministic one-step increment from below-limit to the hard-limit
  boundary,
- module-specific create/admission surfaces emit canonical hard-limit denials at that boundary,
- the emitted denial metadata remains scoped to the correct tenant/workspace,
- and the resulting denial can be projected into the bounded workspace quota overview so operators
  can explain why the action was blocked.

This task does **not** add new contracts, new API routes, new enforcement semantics, or live
integration infrastructure. It validates the baselines already delivered in `T01` through `T05`.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — usage-consumption baseline (already delivered)
T02 — quota posture baseline (already delivered)
T03 — threshold alerts baseline (already delivered)
T04 — hard-limit enforcement baseline (already delivered)
T05 — quota usage / provisioning overview baseline (already delivered)
T06 — THIS TASK: cross-module verification of incremental consumption + enforcement alignment
```

### 2.2 Verification flow to prove

```text
module create/admission validator
        ↓ emits structured quotaDecision (T04)
workspace usage snapshot with the mapped source dimension (T01 vocabulary)
        ↓
workspace quota posture / overview projection (T02 + T05 vocabulary)
        ↓
operator-visible blocked dimension with deterministic posture + blocking reason
```

### 2.3 Covered module families

The verification matrix must cover at least:

- OpenWhisk functions
- Kafka events/topics
- Storage bucket admission
- PostgreSQL database creation
- MongoDB database creation

These module families were already wired into the hard-limit baseline and provide the most direct
story-wide confidence that quota-backed governance is coherent across heterogeneous surfaces.

### 2.4 Incremental implementation rule

This increment stays intentionally narrow:

- **Primary delivery is tests**, not new runtime capability.
- Story-summary documentation is updated so the backlog record reflects the final verification unit.
- Production code changes are allowed only if a deterministic verification defect requires a minimal
  fix; otherwise the diff should remain test/docs-only.

### 2.5 Explicit non-goals

This task will **not**:

- add new quota dimensions,
- change threshold semantics,
- modify alert emission,
- add new create-surface denials,
- add React pages or public API contracts,
- or introduce browser, Docker, or live-provider test infrastructure.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `tests/unit/observability-quota-enforcement-verification.test.mjs` (new)

Add one bounded verification suite that:

- builds one reusable verification matrix for the five covered modules,
- proves each module is **allowed** one increment below the hard limit,
- proves each module is **denied** exactly at the hard-limit boundary,
- asserts every denied case emits a structured `quotaDecision` with canonical hard-limit metadata,
- maps each denied case into a workspace usage snapshot using the decision’s
  `sourceDimensionIds`,
- constructs a bounded workspace quota overview for the mapped source dimension,
- and asserts the overview exposes `hard_limit_reached`, `blockingState=denied`, and the preserved
  blocking reason.

Design constraints:

- keep the test self-contained and deterministic,
- avoid new helper modules unless the test becomes unreasonably repetitive,
- prefer one compact scenario matrix over many almost-identical test files,
- and keep the test focused on the story boundary rather than re-testing every module validator in
  full detail.

### 3.2 `docs/tasks/us-obs-03.md` (update)

Add a `## Scope delivered in 'US-OBS-03-T06'` section summarizing:

- the new cross-module verification matrix,
- the five covered module families,
- the fact that denials remain explainable through the bounded overview vocabulary,
- and that this task closes the story without widening the public/runtime surface.

### 3.3 Spec artifacts

Materialize and keep aligned:

- `specs/042-quota-enforcement-verification/spec.md`
- `specs/042-quota-enforcement-verification/plan.md`
- `specs/042-quota-enforcement-verification/tasks.md`

---

## 4. Data / Verification Model

### 4.1 Per-module scenario shape

Each module scenario in the test matrix should define at least:

- `moduleId`
- `description`
- `buildAllowedCase()`
- `buildDeniedCase()`
- `expectedEnforcementDimensionId`
- `expectedScopeType`
- `expectedSourceDimensionId`

### 4.2 Assertions shared by all scenarios

For every scenario:

1. the below-limit state remains allowed,
2. the hard-limit boundary emits a denied `quotaDecision`,
3. the decision uses `QUOTA_HARD_LIMIT_REACHED`,
4. the decision stays workspace-scoped for the tested create surface,
5. the decision carries at least one mapped `sourceDimensionId`,
6. the workspace usage snapshot increases from `limit-1` to `limit`, and
7. the bounded workspace overview shows the matching dimension as blocked and hard-limited.

### 4.3 Overview-projection rule

The verification must use the existing `T05` helper surface rather than inventing a parallel test
projection. The denied module decision must be attached through `blockingDecisions` and
`sourceDimensionIds`, preserving the exact explainability path that operators rely on.

---

## 5. Risks, Compatibility, and Rollback

### 5.1 Risks

- **Dimension alias mismatch**: a module enforcement dimension may not equal the observability usage
  dimension. Mitigation: rely on the already-published `sourceDimensionIds` linkage rather than
  hard-coding assumptions.
- **Over-testing module internals**: the suite could duplicate all adapter tests. Mitigation: keep
  the matrix focused on the story-level transition and explainability path only.
- **False scope widening**: cross-module tests could accidentally use tenant-only or mixed-scope
  fixtures. Mitigation: keep every scenario explicitly bound to one tenant/workspace pair.

### 5.2 Compatibility

Expected changes are additive and verification-oriented:

- new unit test file,
- additive story-summary documentation,
- additive spec artifacts.

No contract, migration, or runtime rollout is expected.

### 5.3 Rollback

Rollback is trivial because the increment should be test/docs/spec-only. Reverting the branch removes
the verification layer without changing the previously-delivered product baselines.

---

## 6. Verification Strategy

Minimum green set for this increment:

- `node --test tests/unit/observability-quota-enforcement-verification.test.mjs`
- `npm test`

Recommended confidence set before merge:

- `node --test tests/unit/observability-quota-enforcement-verification.test.mjs`
- `node --test tests/adapters/openwhisk-admin.test.mjs`
- `node --test tests/adapters/kafka-admin.test.mjs`
- `node --test tests/adapters/postgresql-admin.test.mjs`
- `node --test tests/adapters/mongodb-admin.test.mjs`
- `node --test tests/adapters/storage-capacity-quotas.test.mjs`
- `npm test`

---

## 7. Recommended Execution Sequence

1. Materialize `spec.md`, `plan.md`, and `tasks.md` for `US-OBS-03-T06`.
2. Add the new cross-module verification test file.
3. Update the story-summary document for `T06`.
4. Run the targeted verification matrix.
5. Run the recommended adapter confidence set if needed.
6. Run `npm test`.
7. Inspect the diff to confirm the increment stayed verification/docs-only unless a minimal bug fix
   was required.
8. Commit, push, open PR, watch CI, fix deterministic failures, merge, and update orchestrator
   state.

---

## 8. Definition of Done

`US-OBS-03-T06` is done when:

- `tests/unit/observability-quota-enforcement-verification.test.mjs` exists and passes,
- the suite covers functions, events, storage, PostgreSQL, and MongoDB,
- each covered module proves one below-limit allowed state and one exact hard-limit denied state,
- denied module decisions are successfully projected into the bounded workspace quota overview,
- `docs/tasks/us-obs-03.md` documents `T06` as the final cross-module verification increment,
- full `npm test` is green,
- and the branch is delivered through commit → push → PR → CI green → merge without widening the
  previously-delivered runtime scope.
