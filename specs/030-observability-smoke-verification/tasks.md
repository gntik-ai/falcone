# Tasks: US-OBS-01-T06 — Observability Smoke Verification

**Input**: `specs/030-observability-smoke-verification/spec.md`
**Feature Branch**: `030-observability-smoke-verification`
**Task**: `US-OBS-01-T06`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/030-observability-smoke-verification/spec.md` with the focused observability smoke-verification specification.
- [x] T002 Materialize `specs/030-observability-smoke-verification/plan.md` with the smoke matrix, e2e, docs, and test-wiring plan.
- [x] T003 Materialize `specs/030-observability-smoke-verification/tasks.md` and keep it aligned with the bounded smoke-verification delta.

## Phase 2 — Smoke matrix and executable test

- [x] T004 Add `tests/reference/observability-smoke-matrix.yaml` as the minimal source of truth for smoke surfaces, shared expectations, and scenario coverage.
- [x] T005 Add `tests/e2e/observability/observability-smoke.test.mjs` to validate scraping, dashboards, and health-state coverage against the checked-in contracts.
- [x] T006 Keep the smoke assertions contract-driven and surface-specific so missing subsystems, widgets, statuses, or freshness thresholds fail deterministically.

## Phase 3 — Discoverability and repository wiring

- [x] T007 Update `tests/reference/README.md` with an entry for `observability-smoke-matrix.yaml`.
- [x] T008 Update `tests/e2e/README.md` with an observability smoke-scaffolding entry.
- [x] T009 Update `docs/tasks/us-obs-01.md` with a `## Scope delivered in 'US-OBS-01-T06'` section summarizing the smoke baseline and residual note.
- [x] T010 Update `package.json` to add `test:e2e:observability` and include it in the root `test` command.

## Phase 4 — Verification

- [x] T011 Run `node --test tests/e2e/observability/observability-smoke.test.mjs`.
- [x] T012 Run `npm test` to ensure the new smoke suite is included in the standard repository test flow.
- [x] T013 Run `npm run lint:md` on the touched documentation set.
- [x] T014 Inspect the final diff to confirm the increment stayed within observability smoke verification, docs, and test wiring.

## Phase 5 — Delivery

- [ ] T015 Commit the branch with a focused message for `US-OBS-01-T06`.
- [ ] T016 Push `030-observability-smoke-verification` to `origin`.
- [ ] T017 Open a PR from `030-observability-smoke-verification` to `main`.
- [ ] T018 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T019 Merge the PR to `main` once green.
- [ ] T020 Update the orchestrator state files with the completed unit and next pending backlog item.
