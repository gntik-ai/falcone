# Implementation Plan: US-OBS-01-T06 — Observability Smoke Verification

**Branch**: `030-observability-smoke-verification` | **Date**: 2026-03-28 | **Spec**: `specs/030-observability-smoke-verification/spec.md`
**Task**: US-OBS-01-T06 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task adds the repository’s smoke-verification layer for observability.

The implementation will:

1. add a small, data-driven smoke matrix that names the required scraping, dashboard, and health scenarios,
2. add an executable e2e smoke test that consumes the existing observability contracts as read-only inputs,
3. verify that the smoke matrix stays aligned with the T01–T05 baseline contract versions,
4. ensure the smoke suite covers the canonical `platform`, `tenant`, and `workspace` scopes,
5. surface the smoke baseline through the repository test command and reference documentation,
6. and update the `US-OBS-01` task summary with the delivered smoke scope.

This increment does **not** create a new observability contract family. It is a verification layer that consumes the metrics, dashboards, health, business-metrics, and console-alerts baselines already checked into the repository.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, YAML reference matrix, Node test runner.
**Primary dependencies**: existing observability contract readers; dashboard, health, metrics, business-metrics, and console-alerts baselines; repository reference assets; markdownlint.
**Storage**: N/A — no database schema or persistence migration.
**Testing**: `node --test` e2e coverage plus markdown documentation checks.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/030-observability-smoke-verification/spec.md`
- `specs/030-observability-smoke-verification/plan.md`
- `specs/030-observability-smoke-verification/tasks.md`
- `tests/reference/observability-smoke-matrix.yaml`
- `tests/e2e/observability/observability-smoke.test.mjs`
- `tests/reference/README.md`
- `tests/e2e/README.md`
- `docs/tasks/us-obs-01.md`
- `package.json`

**Constraints**:

- consume the T01–T05 contracts as read-only sources; never alter observability semantics in the smoke layer,
- keep the smoke matrix small, explicit, and deterministic,
- preserve multi-tenant isolation and masking expectations while asserting runtime parity,
- keep the smoke suite runnable through the existing repository test pipeline,
- and avoid browser automation or live runtime orchestration in this increment.

---

## Architecture / Content Strategy

### 1. A smoke matrix is the source of truth for the verification surface

Add `tests/reference/observability-smoke-matrix.yaml` as the minimal, data-driven source of truth for:

- the required contract version anchors,
- the shared expectations for scopes, statuses, probe types, dimensions, subsystem rosters, and masking categories,
- and the scenario list that names the scraping, dashboard, and health smoke checks.

This matrix is intentionally small. It should be sufficient for execution and for future extension without turning into a second observability contract.

### 2. The e2e smoke test is contract-driven, not browser-driven

Add `tests/e2e/observability/observability-smoke.test.mjs` so the smoke suite can:

- read the matrix,
- read the observability contracts,
- verify source version alignment,
- verify required scope coverage,
- verify the dashboard scope and widget coverage,
- verify the health-status vocabulary and freshness semantics,
- and report precise failure reasons when the smoke matrix drifts.

The smoke test must remain black-box from the perspective of implementation internals: it consumes contract readers and reference data rather than introducing new runtime behavior.

### 3. Smoke coverage mirrors the observability planes already introduced by T01–T05

The smoke assertions should be organized around three surfaces:

- **scraping** — subsystem roster and collection-health evidence,
- **dashboards** — dashboard scope aliases, mandatory dimensions, and widget coverage,
- **health** — probe types, health-state vocabulary, freshness threshold alignment, and scope isolation.

### 4. Reference documentation keeps the smoke baseline discoverable

Update `tests/reference/README.md`, `tests/e2e/README.md`, and `docs/tasks/us-obs-01.md` so the new smoke baseline is discoverable from the testing strategy and the observability task summary.

### 5. Repository test wiring must include the new smoke suite

Update `package.json` so the repository’s standard `test` command runs the new observability smoke suite.

No new production service, endpoint, or deployment artifact is required for this task.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/030-observability-smoke-verification/spec.md` (this document)
- Materialize `specs/030-observability-smoke-verification/plan.md` (this document)
- Materialize `specs/030-observability-smoke-verification/tasks.md`

### Smoke matrix and e2e verification

- Add `tests/reference/observability-smoke-matrix.yaml`
- Add `tests/e2e/observability/observability-smoke.test.mjs`

### Discoverability and task summary

- Update `tests/reference/README.md` with a smoke-matrix entry
- Update `tests/e2e/README.md` with an observability smoke-scaffolding entry
- Update `docs/tasks/us-obs-01.md` with a `US-OBS-01-T06` scope-delivery section and residual note

### Repository test wiring

- Update `package.json` to add `test:e2e:observability`
- Update `package.json` `test` to include the new observability smoke suite

---

## Verification Strategy

### Targeted verification

1. Run the new smoke test directly:
   - `node --test tests/e2e/observability/observability-smoke.test.mjs`
2. Confirm the repository test command includes the new suite:
   - `npm test`
3. Run markdown lint on touched documentation:
   - `npm run lint:md`

### Deterministic evidence expected

- the smoke matrix is read successfully,
- the matrix version matches the checked-in observability contract versions,
- required scopes and statuses are complete,
- all scenario types are represented,
- and the repository test pipeline includes the new observability smoke stage.

---

## Risks and Mitigations

### Risk: the smoke suite becomes a second observability contract

**Mitigation**: keep the matrix small and strictly derivative of T01–T05; do not add new observability semantics in the smoke layer.

### Risk: the smoke suite drifts into live-environment orchestration

**Mitigation**: keep the test contract-driven and matrix-driven; do not add browser automation, live deployment orchestration, or runtime probing code in this increment.

### Risk: smoke failures are too vague to be actionable

**Mitigation**: structure assertions by surface and report the missing subsystem, widget, status, or freshness expectation explicitly.

### Risk: the test command misses the new suite

**Mitigation**: wire the smoke test into `package.json` so `npm test` includes it alongside the existing e2e suites.

---

## Done Criteria

The task is done when:

- the smoke matrix exists and is aligned with the observability contracts,
- the e2e smoke suite passes locally,
- the repo test command includes the new observability smoke coverage,
- the reference docs mention the new smoke baseline,
- and the `US-OBS-01` task summary records the delivered smoke scope and residual note.
