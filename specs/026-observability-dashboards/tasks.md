# Tasks: US-OBS-01-T02 — Global, Tenant, and Workspace Health Dashboards

**Input**: `specs/026-observability-dashboards/spec.md`
**Feature Branch**: `026-observability-dashboards`
**Task**: US-OBS-01-T02

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/026-observability-dashboards/spec.md` with the focused observability dashboard specification.
- [x] T002 Materialize `specs/026-observability-dashboards/plan.md` with the contract, helper, documentation, validation, and verification strategy.
- [x] T003 Materialize `specs/026-observability-dashboards/tasks.md` and keep it aligned with the actual bounded delta.

## Phase 2 — Dashboard contract and helper implementation

- [ ] T004 Add `services/internal-contracts/src/observability-dashboards.json` covering dashboard scopes, hierarchy, mandatory health dimensions, widget semantics, inherited degradation, stale telemetry handling, and workspace fallback rules.
- [ ] T005 Update `services/internal-contracts/src/index.mjs` so the observability dashboards contract is available through shared readers and helper accessors.
- [ ] T006 Extend `apps/control-plane/src/observability-admin.mjs` with summary helpers for dashboard scopes, health dimensions, drilldown semantics, and safe scope-context summaries.
- [ ] T007 Add `scripts/lib/observability-dashboards.mjs` and `scripts/validate-observability-dashboards.mjs` for deterministic validation of the dashboard baseline.
- [ ] T008 Update `package.json` scripts to expose `validate:observability-dashboards` and wire it into repo validation.

## Phase 3 — Documentation and discoverability

- [ ] T009 Add `docs/reference/architecture/observability-health-dashboards.md` documenting the global, tenant, and workspace dashboard hierarchy, scope inheritance, mandatory health dimensions, and stale-data semantics.
- [ ] T010 Update `docs/reference/architecture/README.md` so the new dashboard guide is discoverable from the architecture index.
- [ ] T011 Update `docs/tasks/us-obs-01.md` summarizing the delivered dashboard-definition slice and residual observability scope.

## Phase 4 — Tests and verification

- [ ] T012 Add `tests/unit/observability-dashboards.test.mjs` for helper and validation behavior.
- [ ] T013 Add `tests/contracts/observability-dashboards.contract.test.mjs` for contract, docs-index, and shared-reader alignment.
- [ ] T014 Run `npm run validate:observability-dashboards`.
- [ ] T015 Run targeted observability unit and contract tests.
- [ ] T016 Run markdown lint on the touched documentation set.

## Phase 5 — Delivery

- [ ] T017 Inspect the final diff to confirm the increment stayed within observability dashboard contracts, helper summaries, docs, validation, and tests.
- [ ] T018 Commit the branch with a focused message for `US-OBS-01-T02`.
- [ ] T019 Push `026-observability-dashboards` to `origin`.
- [ ] T020 Open a PR from `026-observability-dashboards` to `main`.
- [ ] T021 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T022 Merge the PR to `main` once green.
- [ ] T023 Update orchestrator state files with the completed unit and next pending backlog item.
