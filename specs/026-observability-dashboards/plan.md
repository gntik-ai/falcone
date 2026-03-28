# Implementation Plan: US-OBS-01-T02 — Global, Tenant, and Workspace Health Dashboards

**Branch**: `026-observability-dashboards` | **Date**: 2026-03-28 | **Spec**: `specs/026-observability-dashboards/spec.md`
**Task**: US-OBS-01-T02 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017

---

## Summary

This task is the second observability increment for the platform.

The implementation will:

1. materialize the repo-local Spec Kit artifacts for task 026,
2. add one machine-readable internal contract that defines the three dashboard scopes (global,
   tenant, workspace), the mandatory health dimensions, scope inheritance rules, drilldown model,
   stale-telemetry handling, and widget semantics,
3. extend the control-plane observability helper surface so downstream work can consume canonical
   dashboard definitions and build safe scope summaries,
4. add deterministic validation for the new dashboard contract and its alignment with the existing
   observability metrics-stack baseline,
5. add one architecture reference document and update the existing task summary,
6. add targeted unit and contract coverage for the new dashboard baseline,
7. and deliver the change through the normal branch, PR, CI, and merge flow.

This increment does **not** implement live dashboard rendering, public API routes, health/readiness
endpoints, alert rules, business metrics, or smoke tests. It defines the contract and helper layer
that later observability tasks and future console work must consume.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON contracts, Markdown docs.
**Primary dependencies**: existing internal-contract readers, observability metrics-stack baseline,
Node test runner, markdownlint.
**Storage**: N/A — no new database schema or persistence migration.
**Testing**: `node --test` for unit and contract coverage, plus repo validation scripts.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Primary artifacts in scope**:

- `specs/026-observability-dashboards/spec.md`
- `specs/026-observability-dashboards/plan.md`
- `specs/026-observability-dashboards/tasks.md`
- `services/internal-contracts/src/observability-dashboards.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `scripts/lib/observability-dashboards.mjs`
- `scripts/validate-observability-dashboards.mjs`
- `docs/reference/architecture/observability-health-dashboards.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-01.md`
- `tests/unit/observability-dashboards.test.mjs`
- `tests/contracts/observability-dashboards.contract.test.mjs`
- `package.json`

**Constraints**:

- consume `US-OBS-01-T01` as the authoritative source for subsystem coverage, normalized metric
  families, scope labels, and collection-health semantics,
- preserve explicit tenant/workspace isolation and avoid presentation-level data leakage,
- stay additive and summary-oriented rather than introducing console UI or public routes,
- distinguish current health, inherited degradation, and stale telemetry explicitly,
- keep the increment reusable by `US-OBS-01-T03` through `US-OBS-01-T06`.

---

## Architecture / Content Strategy

### 1. Dashboard contract as the source of truth

Add `services/internal-contracts/src/observability-dashboards.json` as the machine-readable source
of truth for:

- the three dashboard scopes (`global`, `tenant`, `workspace`),
- the dashboard hierarchy and allowed drilldown transitions,
- mandatory health dimensions (availability, errors, latency, throughput, collection freshness),
- widget families and summary cards expected for each scope,
- inherited-degradation semantics,
- workspace-attribution limitations and fallback behavior,
- stale/missing telemetry handling,
- and the authorization / traceability expectations for each scope.

This keeps dashboard behavior aligned with the repo's existing contract-first patterns while
avoiding premature UI implementation.

### 2. Shared readers expose dashboard definitions safely

Update `services/internal-contracts/src/index.mjs` so downstream code can:

- read the observability dashboards contract,
- list dashboard scopes,
- resolve a scope definition,
- and inspect drilldown or widget metadata without reading raw files directly.

The helper shape should mirror the existing observability metrics-stack reader pattern.

### 3. Control-plane helper stays summary-oriented

Extend `apps/control-plane/src/observability-admin.mjs` with read-only helpers that:

- summarize the full dashboard baseline,
- list supported dashboard scopes and mandatory dimensions,
- describe how scope inheritance works,
- build safe dashboard query context summaries,
- and expose workspace-fallback semantics for subsystems that do not safely support workspace
  attribution.

No public route, OpenAPI, or console rendering change is needed in this increment.

### 4. Deterministic validation guards drift

Add `scripts/lib/observability-dashboards.mjs` and `scripts/validate-observability-dashboards.mjs`
so future tasks cannot silently drift from the agreed baseline.

Validation should confirm:

- all three scopes exist,
- every scope includes the mandatory health dimensions,
- the contract references only the seven subsystems already defined by
  `observability-metrics-stack.json`,
- workspace fallback behavior is explicit for subsystems that are not workspace-safe,
- stale-telemetry semantics are documented,
- the docs index and task summary stay discoverable,
- and `package.json` exposes `validate:observability-dashboards` and wires it into repo
  validation.

### 5. Human-readable architecture companion

Add `docs/reference/architecture/observability-health-dashboards.md` as the operator and
implementation companion for the dashboard baseline.

The document should explain:

- the global → tenant → workspace hierarchy,
- what each dashboard scope must communicate,
- mandatory health dimensions,
- how inherited platform degradation is shown in narrower scopes,
- workspace-attribution boundaries,
- stale/missing telemetry handling,
- and how future console, alerting, and smoke-test work should consume the baseline.

---

## Planned Changes by Artifact

### Spec Kit artifacts

- Materialize `specs/026-observability-dashboards/spec.md`
- Materialize `specs/026-observability-dashboards/plan.md`
- Materialize `specs/026-observability-dashboards/tasks.md`

### Internal contracts and helper code

- Add `services/internal-contracts/src/observability-dashboards.json`
- Update `services/internal-contracts/src/index.mjs`
- Extend `apps/control-plane/src/observability-admin.mjs`
- Add `scripts/lib/observability-dashboards.mjs`
- Add `scripts/validate-observability-dashboards.mjs`
- Update `package.json` to expose and wire the new validation command

### Documentation

- Add `docs/reference/architecture/observability-health-dashboards.md`
- Update `docs/reference/architecture/README.md`
- Update `docs/tasks/us-obs-01.md` to summarize the delivered dashboard-definition slice and
  residual scope

### Tests and validation wiring

- Add `tests/unit/observability-dashboards.test.mjs`
- Add `tests/contracts/observability-dashboards.contract.test.mjs`

### No-change areas

- No public OpenAPI or route catalog changes
- No console UI rendering
- No chart or Helm values changes
- No health/readiness/liveness endpoints
- No alert-rule or notification wiring
- No business KPI definition changes

---

## Verification Strategy

1. Run `npm run validate:observability-dashboards`.
2. Run targeted observability unit and contract suites.
3. Run `npm run lint:md` on the touched markdown set.
4. Run broader repo validation only if the bounded delta touches shared surfaces outside the
   dashboard contract baseline.
5. Inspect `git diff --stat` to confirm the increment stayed within observability dashboard
   contracts, helper summaries, docs, validation, and tests.

---

## Risks and Mitigations

- **Risk: dashboard contract overclaims UI implementation**
  - Mitigation: keep all artifacts contract- and summary-oriented; avoid component, chart-library,
    or route-level decisions.
- **Risk: workspace views imply unsupported precision**
  - Mitigation: encode explicit fallback semantics and unavailable states for subsystems that are
    only safe at tenant scope.
- **Risk: narrower scopes leak platform or cross-tenant information**
  - Mitigation: treat scope inheritance and visibility rules as first-class contract elements and
    test them explicitly.
- **Risk: stale telemetry is misread as healthy status**
  - Mitigation: require collection freshness as a mandatory dashboard dimension and validate the
    stale/unknown state semantics.
- **Risk: future observability tasks redefine health views independently**
  - Mitigation: document this task as the canonical dashboard baseline consumed by T03–T06.

---

## Sequence

1. Materialize the Spec Kit files for task 026.
2. Add the internal observability dashboards contract and wire it into shared readers.
3. Extend the control-plane helper with dashboard summary and scope semantics.
4. Add the validation library and dedicated validation command.
5. Add the architecture companion and update the task summary docs.
6. Add targeted unit and contract coverage.
7. Run validation, tests, and markdown lint.
8. Commit, push, open PR, watch CI, fix deterministic regressions, and merge when green.

---

## Done Criteria

This unit is complete when:

- the Spec Kit artifacts are present,
- the observability dashboards contract is committed and available through shared readers,
- the control-plane helper exposes dashboard summaries and scope semantics,
- the new architecture guide is discoverable from the architecture index,
- the task summary reflects both `US-OBS-01-T01` and `US-OBS-01-T02`,
- `npm run validate:observability-dashboards` passes,
- targeted unit and contract tests pass,
- touched markdown lint passes,
- the branch is merged to `main`,
- and orchestrator state advances to the next backlog item.
