# Feature Specification: US-OBS-01-T06 — Observability Smoke Verification

**Feature Branch**: `030-observability-smoke-verification`  
**Task**: `US-OBS-01-T06`  
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad  
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks  
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017  
**Dependencies**: US-DEP-01, US-GW-04, US-OBS-01-T01, US-OBS-01-T02, US-OBS-01-T03, US-OBS-01-T04, US-OBS-01-T05  
**Created**: 2026-03-28  
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-01-T01` through `US-OBS-01-T05` define the canonical observability plane for the platform:

- a unified metrics stack,
- canonical dashboard scopes,
- component health and probe semantics,
- business-metrics vocabulary,
- and console-facing summary/alert semantics.

What is still missing is an **executable smoke verification layer** that confirms the runtime-facing observability surfaces still line up with those contracts after changes, deployment, or refactoring.

Without this task:

- scraping regressions can silently remove a subsystem from the observability plane,
- dashboard drift can break scope coverage without surfacing in the contract layer,
- health-state regressions can collapse `healthy`/`degraded`/`unavailable`/`stale`/`unknown` into ambiguous output,
- and operators or release engineers must manually inspect multiple artifacts to know whether observability still works end to end.

This task defines a **smoke verification suite** that remains deliberately small, deterministic, and contract-driven. It verifies that the platform can still:

1. scrape the required observability subsystems,
2. present the canonical dashboard scopes and dimensions,
3. and expose health states and freshness semantics consistently across platform, tenant, and workspace views.

This task does **not** redefine the observability contracts themselves. It consumes the T01–T05 baselines and asserts that the checked-in smoke matrix and executable smoke test stay aligned with them.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Release engineers** need a fast gate that tells them whether an observability change or deployment has broken the scrape, dashboard, or health surface before promotion.
- **SREs and platform operators** need a concise runtime smoke signal so they can distinguish a platform issue from a contract/documentation issue.
- **QA and automation maintainers** need a black-box smoke target that is stable enough to run in CI without browser automation or manual interpretation.
- **Control-plane maintainers** need confidence that observability helper output still matches the underlying observability contracts.
- **Tenant owners** benefit indirectly because a healthy smoke baseline reduces the chance that tenant-visible health views drift from reality.

### Value delivered

- Confirms that the observability plane remains intact after changes.
- Catches missing scrape targets, dashboard scope drift, and health-state drift early.
- Preserves the existing contract vocabulary by making the smoke suite consume it rather than inventing a parallel model.
- Creates a repeatable verification surface for future deployment and operational workflows.

---

## 3. In-Scope Capability

### In scope

- Define a small, data-driven smoke matrix for observability verification.
- Verify coverage for three observability surfaces:
  - **scraping** — the required subsystem roster is still present in the observability plane,
  - **dashboards** — the canonical `global`, `tenant`, and `workspace` dashboard scopes still resolve,
  - **health** — the health-state vocabulary and freshness semantics still align with the upstream contracts.
- Validate that the smoke matrix remains aligned with the T01–T05 contract versions.
- Validate that the smoke suite remains scope-safe and does not widen tenant or workspace visibility.
- Provide a deterministic executable test target that can run in the repository test pipeline.

### Out of scope

- Changing the production metrics pipeline, dashboard definitions, health endpoints, or alert delivery behavior.
- Adding browser automation, screenshots, or manual exploratory workflows.
- Introducing new alert categories, public APIs, or UI rendering work.
- Re-tuning metric thresholds, probe thresholds, or operational alert thresholds.
- Load testing, chaos testing, or long-running resilience scenarios.
- Any change that would require the smoke suite to guess at runtime behavior not already represented in the checked-in contracts.

---

## 4. User Scenarios & Testing

### User Story 1 — Release smoke gate for observability scraping (Priority: P1)

As a release engineer, I need a smoke check that confirms observability scraping still covers every required subsystem so I can catch missing telemetry before promoting a change.

**Why this priority**: If scraping breaks, every downstream observability view becomes less trustworthy. This is the earliest and cheapest place to detect failure.

**Independent Test**: A reviewer can verify that the smoke matrix explicitly covers the required subsystem roster and that the executable smoke test fails when a required subsystem or collection-health metric is missing or stale.

**Acceptance Scenarios**:

1. **Given** the required observability subsystems are all exposed, **when** the smoke suite runs, **then** the scraping check passes and confirms the full subsystem roster.
2. **Given** one required subsystem or collection-health signal is missing, **when** the smoke suite runs, **then** the scraping check fails with the missing subsystem or metric identified.

---

### User Story 2 — Dashboard smoke coverage across all supported scopes (Priority: P1)

As an SRE or platform operator, I need a smoke check that confirms the canonical dashboard scopes still exist and map to the expected observability dimensions so I can trust the console and operational views.

**Why this priority**: Dashboards are the primary human entry point into the observability plane. Scope drift or widget drift makes the system look healthy or unhealthy for the wrong reasons.

**Independent Test**: A reviewer can verify that the smoke matrix includes `global`, `tenant`, and `workspace` coverage, that the test checks the mandatory dimensions, and that no dashboard scope widens beyond its contract.

**Acceptance Scenarios**:

1. **Given** the dashboard contract exposes `global`, `tenant`, and `workspace` scopes, **when** the smoke suite runs, **then** the dashboard check passes for all three scopes.
2. **Given** a dashboard scope loses a mandatory dimension or references an unknown widget, **when** the smoke suite runs, **then** the dashboard check fails with the exact drift reason.

---

### User Story 3 — Health-state smoke verification (Priority: P1)

As a platform maintainer, I need a smoke check that confirms the health-state vocabulary and freshness semantics still align with the health contracts so I can trust that `healthy`, `degraded`, `unavailable`, `stale`, and `unknown` are still being surfaced consistently.

**Why this priority**: Health-state drift is subtle but dangerous. If the smoke check does not validate the vocabulary and freshness semantics, operators may interpret stale or partial data as a current healthy signal.

**Independent Test**: A reviewer can verify that the smoke suite validates the health summary status vocabulary, probe-type coverage, freshness threshold alignment, and scope isolation for platform, tenant, and workspace views.

**Acceptance Scenarios**:

1. **Given** the health contracts still expose the canonical status vocabulary and freshness threshold, **when** the smoke suite runs, **then** the health check passes and reports the expected states.
2. **Given** the health state vocabulary drifts or the freshness threshold no longer matches the upstream contract, **when** the smoke suite runs, **then** the health check fails with a contract-specific reason.

---

## 5. Edge Cases

- What happens when the scrape target exists but returns stale collection-health evidence?
- How does the smoke suite react when a dashboard scope exists but the scope alias no longer matches the canonical `global` / `tenant` / `workspace` mapping?
- What happens when the health summary reports `unknown` because evidence is incomplete but the smoke suite cannot confirm whether the component is healthy?
- How does the smoke suite handle a tenant or workspace view that attempts to rely on cross-tenant detail or unmasked content?
- What happens when a required widget, subsystem, or probe type is present in one contract but missing from the smoke matrix?
- How should the smoke suite behave if the observability plane is available but one scope intentionally degrades while the others remain healthy?

---

## 6. Requirements

### Functional Requirements

- **FR-001**: The smoke suite MUST consume the T01–T05 observability contracts as read-only inputs and MUST NOT redefine their scope, status, or masking semantics.
- **FR-002**: The smoke suite MUST verify that the required observability surfaces are present for scraping, dashboards, and health.
- **FR-003**: The smoke matrix MUST include coverage for the `platform`, `tenant`, and `workspace` scopes.
- **FR-004**: The smoke suite MUST validate that the dashboard scopes remain aligned with the canonical `global`, `tenant`, and `workspace` aliases.
- **FR-005**: The smoke suite MUST validate that the health-state vocabulary includes `healthy`, `degraded`, `unavailable`, `stale`, and `unknown`.
- **FR-006**: The smoke suite MUST validate that the freshness threshold used by the health smoke checks matches the upstream health contract and the console-summary baseline.
- **FR-007**: The smoke suite MUST fail deterministically when a required subsystem, widget, metric family, probe type, or status is missing, renamed, or stale.
- **FR-008**: The smoke suite MUST report failures with enough context to identify the broken surface and the missing contract element.
- **FR-009**: The smoke suite MUST preserve multi-tenant isolation and MUST NOT depend on cross-tenant or raw sensitive detail.
- **FR-010**: The smoke suite MUST be runnable through the repository test pipeline without browser automation or manual operator intervention.
- **FR-011**: Any smoke matrix file or reference asset MUST be discoverable from the testing reference documentation and the observability task summary.

### Key Entities

- **Smoke Scenario**: A named observability assertion covering a single focus area such as scraping, dashboards, or health.
- **Observability Surface**: The contract-backed runtime facet being verified, such as subsystem scraping, dashboard scope coverage, or health-state projection.
- **Smoke Matrix**: The checked-in data file that lists the required scenarios and shared expectations.
- **Smoke Result**: The pass/fail outcome with surface-specific evidence and a concrete failure reason.
- **Evidence Set**: The contract-derived inputs used by the smoke suite to decide whether a scenario passes.

---

## 7. Success Criteria

### Measurable Outcomes

- **SC-001**: The smoke suite covers every required observability surface and every supported scope in a single deterministic run.
- **SC-002**: If one required subsystem, widget, metric family, probe type, or health status is removed or renamed, the smoke suite fails on the first relevant assertion.
- **SC-003**: The smoke suite can be executed as part of the standard repository test command without requiring browser automation.
- **SC-004**: The smoke matrix and its documentation are discoverable from the repository reference docs and the `US-OBS-01` task summary.
- **SC-005**: The smoke suite produces failure messages that identify the exact surface and contract drift rather than a generic pass/fail result.
