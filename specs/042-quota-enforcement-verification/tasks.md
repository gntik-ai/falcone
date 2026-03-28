# Tasks: US-OBS-03-T06 — Cross-Module Incremental Consumption and Quota Enforcement Verification

**Input**: `specs/042-quota-enforcement-verification/plan.md`
**Feature Branch**: `042-quota-enforcement-verification`
**Task**: `US-OBS-03-T06`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

### Spec artifacts

- `specs/042-quota-enforcement-verification/plan.md`
- `specs/042-quota-enforcement-verification/tasks.md`

### Existing helper references (read-only)

- `apps/control-plane/src/observability-admin.mjs`
- `services/adapters/src/openwhisk-admin.mjs`
- `services/adapters/src/kafka-admin.mjs`
- `services/adapters/src/postgresql-admin.mjs`
- `services/adapters/src/mongodb-admin.mjs`
- `services/adapters/src/storage-capacity-quotas.mjs`
- `package.json`
- `docs/tasks/us-obs-03.md`

### Existing test/pattern references (read-only)

- `tests/unit/observability-usage-consumption.test.mjs`
- `tests/unit/observability-hard-limit-enforcement.test.mjs`
- `tests/unit/observability-quota-usage-view.test.mjs`
- `tests/adapters/openwhisk-admin.test.mjs`
- `tests/adapters/kafka-admin.test.mjs`
- `tests/adapters/postgresql-admin.test.mjs`
- `tests/adapters/mongodb-admin.test.mjs`
- `tests/adapters/storage-capacity-quotas.test.mjs`

### New or updated delivery targets

- `tests/unit/observability-quota-enforcement-verification.test.mjs`
- `docs/tasks/us-obs-03.md`
- `specs/042-quota-enforcement-verification/spec.md`
- `specs/042-quota-enforcement-verification/plan.md`
- `specs/042-quota-enforcement-verification/tasks.md`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/042-quota-enforcement-verification/spec.md` with the bounded `US-OBS-03-T06` verification scope.
- [x] T002 Materialize `specs/042-quota-enforcement-verification/plan.md` with the cross-module verification objective, boundaries, and validation flow.
- [x] T003 Materialize `specs/042-quota-enforcement-verification/tasks.md` and keep it aligned with the bounded `T06` delta.

## Phase 2 — Cross-module verification suite

- [ ] T004 Add `tests/unit/observability-quota-enforcement-verification.test.mjs` covering a compact scenario matrix for:
  - OpenWhisk functions,
  - Kafka topics/events,
  - storage bucket admission,
  - PostgreSQL database creation,
  - MongoDB database creation.
- [ ] T005 For every scenario in the matrix, assert:
  - one below-limit allowed state,
  - one exact hard-limit denied state,
  - structured `quotaDecision` metadata with canonical error code,
  - stable workspace scope metadata,
  - at least one `sourceDimensionId`,
  - a one-step usage increment from `limit - 1` to `limit`,
  - and a bounded workspace overview projection showing `hard_limit_reached` plus `blockingState=denied`.

## Phase 3 — Story-summary documentation

- [ ] T006 Update `docs/tasks/us-obs-03.md` with a `## Scope delivered in 'US-OBS-03-T06'` section summarizing the cross-module verification matrix, covered module families, explainable blocking path, and story-closing boundary.

## Phase 4 — Verification

- [ ] T007 Run `node --test tests/unit/observability-quota-enforcement-verification.test.mjs`.
- [ ] T008 Run the module confidence set as needed:
  - `node --test tests/adapters/openwhisk-admin.test.mjs`
  - `node --test tests/adapters/kafka-admin.test.mjs`
  - `node --test tests/adapters/postgresql-admin.test.mjs`
  - `node --test tests/adapters/mongodb-admin.test.mjs`
  - `node --test tests/adapters/storage-capacity-quotas.test.mjs`
- [ ] T009 Run `npm test` successfully.
- [ ] T010 Inspect the final diff to confirm the increment stayed verification/docs-only unless a minimal deterministic bug fix was required.

## Phase 5 — Delivery

- [ ] T011 Commit the branch with a focused message for `US-OBS-03-T06`.
- [ ] T012 Push `042-quota-enforcement-verification` to `origin`.
- [ ] T013 Open a PR from `042-quota-enforcement-verification` to `main`.
- [ ] T014 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T015 Merge the PR to `main` once green.
- [ ] T016 Update the orchestrator state files with the completed unit (`US-OBS-03-T06`) and the next pending backlog status.
