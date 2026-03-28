# Feature Specification: US-OBS-03-T06 — Cross-Module Incremental Consumption and Quota Enforcement Verification

**Feature Branch**: `042-quota-enforcement-verification`
**Task**: `US-OBS-03-T06`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: US-OBS-03-T01, US-OBS-03-T02, US-OBS-03-T03, US-OBS-03-T04, US-OBS-03-T05
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

The story `US-OBS-03` already delivered the bounded building blocks for quota-backed governance:

- `T01` established tenant/workspace usage snapshots,
- `T02` established quota posture evaluation,
- `T03` established threshold-alert transitions,
- `T04` established hard-limit admission denials, and
- `T05` established the operator-facing usage-vs-quota overview.

What is still missing is one explicit verification increment that proves these pieces behave
coherently across multiple product modules instead of only inside isolated unit surfaces.

Without this verification increment:

- platform operators cannot prove that real usage increments line up with quota posture and
  hard-limit denial behavior across different module families,
- release readiness for the quota story depends on reading several unrelated test suites rather than
  one bounded verification matrix,
- and downstream changes could silently drift so a module still denies on quota while the
  observability view no longer explains why.

This task delivers the final bounded verification layer for the story: an automated cross-module test
matrix that proves incremental consumption and quota enforcement remain aligned for storage,
functions, events, PostgreSQL, and MongoDB surfaces.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Superadmin / SRE** | Gains one authoritative verification suite showing that usage growth, quota posture, and hard-limit denials stay consistent across critical modules. |
| **Security / governance** | Can verify that tenant/workspace scope boundaries and denial metadata remain deterministic and auditable across modules. |
| **Tenant owner** | Indirectly benefits because blocked operations remain explainable through the same quota vocabulary surfaced in T05. |
| **Delivery / release reviewers** | Gain a final story-completion artifact that proves the quota-backed platform behavior is testable end-to-end without introducing a second quota model. |

---

## User Scenarios & Testing

### User Story 1 — Operator verifies quota-backed module behavior stays consistent (Priority: P1)

A platform operator needs one automated proof that quota-backed create flows across functions,
events, storage, PostgreSQL, and MongoDB behave consistently when usage grows from below the limit
to the hard-limit boundary.

**Why this priority**: This is the terminal verification increment for the story. Without it, the
story remains a set of independent baselines rather than a provably coherent capability.

**Independent Test**: Run the cross-module verification suite and confirm that each covered module
allows the last below-limit step and then produces a deterministic hard-limit denial at the next
increment.

**Acceptance Scenarios**:

1. **Given** a workspace is one unit below a module hard limit, **When** the verification suite
   simulates the next allowed state, **Then** the module remains allowed and no hard-limit denial is
   produced.
2. **Given** the same workspace reaches the module hard limit on the next increment, **When** the
   verification suite evaluates the create flow, **Then** the module emits a structured
   `QUOTA_HARD_LIMIT_REACHED` decision with stable scope and dimension metadata.

---

### User Story 2 — Operator can explain blocked module actions through the quota overview (Priority: P2)

A superadmin or tenant-facing operator needs the blocked action to remain explainable through the
same quota usage overview delivered in `T05`, instead of a module-specific denial that cannot be
traced back to the observability layer.

**Why this priority**: A quota denial that is not visible in the observability vocabulary creates an
operator gap and weakens the product promise of explainable blocking.

**Independent Test**: For each verified module, map the emitted hard-limit decision into a workspace
quota overview and confirm the dimension becomes visibly blocked with the expected posture and
blocking reason.

**Acceptance Scenarios**:

1. **Given** a module emits a hard-limit denial, **When** the verification suite builds the bounded
   workspace quota overview, **Then** the matching dimension is shown with `hard_limit_reached` and
   `blockingState=denied`.
2. **Given** a module denial is linked through `sourceDimensionIds`, **When** the overview is built,
   **Then** the denial is attached to the correct observability dimension without widening scope.

---

### User Story 3 — Release reviewer confirms the story closed without widening scope (Priority: P3)

A reviewer needs confidence that the final story increment validates the existing baselines without
silently expanding into new contracts, API changes, or runtime behavior.

**Why this priority**: This task is the terminal verification step and must stay bounded.

**Independent Test**: Inspect the diff and run the suite to confirm the increment adds verification
and documentation only, without changing quota policy semantics or public API surfaces.

**Acceptance Scenarios**:

1. **Given** the final diff for `US-OBS-03-T06`, **When** it is reviewed, **Then** it is limited to
   the new verification test coverage, story-summary documentation, and spec artifacts.

---

## Edge Cases

- What happens when a module quota decision uses a module-facing enforcement dimension while the
  overview uses an observability source dimension? The verification must prove `sourceDimensionIds`
  keep the linkage intact.
- What happens when a quota limit is reached exactly, not exceeded? The verification must prove the
  hard-limit denial still occurs deterministically at the boundary.
- What happens when scope metadata is incomplete or widened? The verification must keep every test
  bounded to one tenant and one workspace and must not assert cross-tenant behavior.
- What happens when the usage view is built from a denial but the denial reason is module-specific?
  The verification must preserve the canonical hard-limit error code while keeping the module reason
  code discoverable.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide an automated verification suite for `US-OBS-03-T06` covering
  at least these module families: functions, events, storage, PostgreSQL, and MongoDB.
- **FR-002**: The verification suite MUST prove, for each covered module, a deterministic transition
  from an allowed below-limit state to a denied hard-limit state after one bounded increment.
- **FR-003**: The verification suite MUST assert that each denied module flow produces structured
  quota-enforcement metadata with canonical error code, scope metadata, and dimension identity.
- **FR-004**: The verification suite MUST assert that each covered module denial can be projected
  into the bounded quota-usage overview without introducing a second quota vocabulary.
- **FR-005**: The verification suite MUST remain tenant/workspace bounded and MUST NOT require live
  provider access, external services, or broad exploratory runtime setup.
- **FR-006**: The implementation for this task MUST stay additive and MUST NOT change public API
  contracts, quota semantics, or production enforcement behavior unless a deterministic test defect
  makes a minimal fix unavoidable.
- **FR-007**: The story summary documentation MUST describe `US-OBS-03-T06` as the cross-module
  verification increment and preserve the residual terminal boundary that the story is complete after
  this unit.

### Key Entities

- **Module quota decision**: The structured hard-limit decision emitted by a module-specific create
  surface when quota admission fails.
- **Observability source dimension**: The usage dimension that explains the module denial inside the
  bounded quota/usage overview.
- **Workspace verification matrix**: The grouped set of cross-module scenarios proving incremental
  usage, denial behavior, and overview explainability remain aligned.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: One automated verification suite covers all five required module families and passes in
  CI without requiring external infrastructure.
- **SC-002**: For every covered module, the suite proves one below-limit allowed state and one exact
  hard-limit denied state.
- **SC-003**: For every covered module, the suite proves the denied state is visible through the
  bounded quota usage overview with `overallPosture=hard_limit_reached` and `blockingState=denied`.
- **SC-004**: The final `US-OBS-03-T06` diff remains bounded to verification/docs/spec artifacts and
  does not introduce new public routes, contracts, or runtime behaviors beyond what is needed to fix
  deterministic verification gaps.
