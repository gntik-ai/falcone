# Tasks: BaaS Internal Service Map and Contract Baseline

**Input**: Planning documents from `/specs/us-arc-01-t01/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `service-map.md`, `quickstart.md`

## Phase 1: Specification and planning

- [x] T001 Create `specs/us-arc-01-t01/spec.md` from the T01 specify prompt.
- [x] T002 Create `specs/us-arc-01-t01/plan.md` from the T01 plan prompt.
- [x] T003 Add supporting package docs in `research.md`, `service-map.md`, `quickstart.md`, and `tasks.md`.
- [x] T004 Add `docs/tasks/us-arc-01-t01.md` to trace the implementation.

## Phase 2: Architecture baseline artifacts

- [x] T005 Add `docs/adr/0003-control-plane-service-map.md`.
- [x] T006 Add a machine-readable service-map and contract catalog in `services/internal-contracts/src/internal-service-map.json`.
- [x] T007 Add helper accessors in `services/internal-contracts/src/index.mjs`.

## Phase 3: Minimal scaffolding

- [x] T008 Add `services/provisioning-orchestrator/` package scaffolding and contract-boundary helper.
- [x] T009 Add `services/audit/` package scaffolding and contract-boundary helper.
- [x] T010 Add control-plane and adapter boundary helpers that consume the shared contract package.
- [x] T011 Update repository documentation to expose the new architecture baseline.

## Phase 4: Validation and tests

- [x] T012 Add `scripts/lib/service-map.mjs` and `scripts/validate-service-map.mjs`.
- [x] T013 Add lightweight unit, adapter, and contract tests for the service-map package.
- [x] T014 Update root scripts and structure validation to cover the new baseline.
- [x] T015 Run relevant repository validation commands and record outcomes.
