# Feature Specification: US-OBS-01-T02 — Global, Tenant, and Workspace Health Dashboards

**Feature Branch**: `026-observability-dashboards`
**Task**: US-OBS-01-T02
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-01 — Métricas unificadas, dashboards y health checks
**Requirements traceability**: RF-OBS-001, RF-OBS-002, RF-OBS-003, RF-OBS-016, RF-OBS-017
**Dependencies**: US-DEP-01, US-GW-04, US-OBS-01-T01
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-01-T01` established the common observability plane and the normalized metrics vocabulary for
APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane. That foundation is
necessary but not yet usable enough for operators or tenant-facing governance flows: the metrics now
exist, but there is no agreed dashboard surface that organizes those signals into a health view for
platform-wide operations, tenant-safe operations, or workspace-level diagnosis.

Without this task, each consumer must build ad hoc queries against the metrics plane and interpret
raw series manually. Platform incidents are slower to triage, tenant owners cannot reliably inspect
service health within their scope, and workspace-level issues remain harder to isolate from broader
platform or tenant degradation. The absence of a standard dashboard contract also creates a risk
that later console and alerting work will invent inconsistent views of system health.

This task delivers the **behavioral definition of three dashboard scopes** — global, tenant, and
workspace — including what each dashboard must communicate, how scope boundaries behave, and which
health signals are mandatory at each level. It does **not** implement health/readiness/liveness
endpoints, business metrics, alert rules, or observability smoke tests. It also does **not** claim
live visualization tooling; it defines the dashboard capability that downstream implementation and
console work must realize.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **SRE and platform operators** need a global health dashboard that shows cross-component posture,
  data freshness, and degraded subsystems from one operational view.
- **Superadmins** need to navigate from platform-wide degradation into tenant-specific health
  without losing the distinction between platform-global and tenant-attributable signals.
- **Tenant owners** need a tenant-scoped health dashboard that explains whether their tenant is
  degraded because of platform-wide issues, tenant-specific pressure, or workspace-local problems.
- **Workspace operators and delegated support roles** need a workspace-scoped health dashboard that
  highlights the subset of signals that can be safely attributed to one workspace.
- **Security and audit stakeholders** need confidence that dashboard scope obeys the same
  multi-tenant isolation rules as the underlying observability plane and that sensitive metrics do
  not leak through presentation-level aggregation.
- **Downstream sibling tasks (T03–T06)** need an agreed dashboard contract so health endpoints,
  business metrics, console summaries, alerts, and smoke tests all build on the same definitions.

### Value delivered

- Defines one standard dashboard model for platform, tenant, and workspace health.
- Makes the common metrics plane operable by humans instead of requiring raw query knowledge.
- Preserves multi-tenant safety at the presentation layer, not just the metric label layer.
- Clarifies which signals belong in each scope and how unsupported scope granularity must be shown.
- Provides a stable foundation for future console, alerting, and smoke-test work without expanding
  scope into those tasks.

---

## 3. In-Scope Capability

This task covers the **definition of dashboard surfaces for health visibility at three scopes**:
platform-global, tenant, and workspace.

### In scope

- Define the global health dashboard and the minimum information it must show across all seven BaaS
  subsystems.
- Define the tenant health dashboard and how it filters or summarizes only the signals attributable
  to one tenant.
- Define the workspace health dashboard and the rules for including only signals that are safely
  attributable to one workspace.
- Specify the mandatory health dimensions each dashboard must present: availability posture, error
  posture, latency posture, throughput posture, and observability collection freshness.
- Specify how platform-scoped signals must be distinguished from tenant-scoped and workspace-scoped
  signals within the dashboard model.
- Define how dashboards communicate partial degradation, missing data, stale collection, and scope
  limitations.
- Define expected navigation or drilldown relationships between scopes as behavior, not as a UI or
  routing implementation.
- Define the authorization and isolation expectations for viewing each dashboard scope.
- Define the minimum dashboard output needed by operations and by the future console summary work.

### Out of scope

- Implementing live dashboard rendering, chart libraries, or visualization tooling.
- Implementing health, readiness, or liveness endpoints (`US-OBS-01-T03`).
- Defining business/product KPIs beyond technical health (`US-OBS-01-T04`).
- Creating the console's summarized health or degradation views (`US-OBS-01-T05`).
- Creating alert rules, paging policies, or notification workflows.
- Writing smoke tests for dashboard correctness or live scraping (`US-OBS-01-T06`).
- Expanding the metrics-plane contract established by `US-OBS-01-T01` beyond what is minimally
  required to support dashboard semantics.

---

## 4. User Scenarios & Testing

### User Story 1 — SRE reviews global platform health from one dashboard (Priority: P1)

An SRE needs one operational dashboard that summarizes the health posture of APISIX, Kafka,
PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane without manually assembling raw
metric queries.

**Why this priority**: Platform-wide operations need a single source of truth before any tenant or
workspace drilldown is useful. If the global dashboard is unclear, incident triage starts from the
wrong context.

**Independent Test**: Open the defined global dashboard and verify that all seven subsystems are
represented with normalized health posture, collection freshness, and visible degraded-state cues.

**Acceptance Scenarios**:

1. **Given** a healthy platform with all seven subsystems reporting into the observability plane,
   **When** an SRE views the global dashboard, **Then** they can see one normalized health summary
   for every subsystem plus the freshness of observability collection.
2. **Given** one subsystem is degraded while the others remain healthy, **When** an SRE views the
   global dashboard, **Then** the degraded subsystem is clearly identified without requiring a raw
   metric query.
3. **Given** the observability plane is receiving stale or failed collection data for one
   subsystem, **When** the SRE views the global dashboard, **Then** the dashboard distinguishes
   stale/missing telemetry from confirmed healthy status.

---

### User Story 2 — Tenant owner reviews tenant-scoped health safely (Priority: P1)

A tenant owner needs a tenant-scoped dashboard that explains the health of platform capabilities as
experienced by their tenant without exposing another tenant's data or mixing in unsupported
platform-global views.

**Why this priority**: The platform is multi-tenant. A tenant-facing health dashboard is only
useful if it is both informative and isolation-safe.

**Independent Test**: Open the tenant dashboard for tenant A and verify that only tenant A's
attributable signals appear, platform-global signals are clearly marked or excluded by policy, and
no data from tenant B is visible.

**Acceptance Scenarios**:

1. **Given** multiple tenants are generating platform traffic, **When** a tenant owner views their
   tenant dashboard, **Then** only health signals attributable to their tenant are included.
2. **Given** a platform-global incident affects all tenants, **When** a tenant owner views their
   tenant dashboard, **Then** the dashboard may communicate that dependency but must not expose
   another tenant's operational details.
3. **Given** a subsystem only supports tenant-level attribution and not workspace-level attribution,
   **When** a tenant owner views the tenant dashboard, **Then** the dashboard shows the tenant-safe
   signal without falsely claiming workspace detail.

---

### User Story 3 — Workspace operator isolates workspace-local degradation (Priority: P2)

A workspace operator needs a workspace-scoped health dashboard that highlights the signals safely
attributable to one workspace so they can distinguish local issues from tenant-wide or
platform-wide degradation.

**Why this priority**: Workspace diagnosis is a common operational task, but not every subsystem can
safely attribute signals to the workspace level. The dashboard contract must make that limitation
explicit rather than fabricate precision.

**Independent Test**: Open a workspace dashboard and verify that workspace-safe signals are shown,
non-workspace-safe signals are either omitted or marked as inherited/unsupported, and the workspace
view remains bounded to its owning tenant/workspace scope.

**Acceptance Scenarios**:

1. **Given** a workspace with scoped traffic and operations, **When** an operator views the
   workspace dashboard, **Then** the dashboard shows workspace-attributable health signals using the
   normalized scope rules from the observability plane.
2. **Given** a subsystem does not safely expose workspace-level attribution, **When** the operator
   views the workspace dashboard, **Then** that subsystem is marked as tenant-level or unavailable
   for workspace detail rather than displaying misleading workspace data.
3. **Given** the workspace is impacted by a tenant-wide or platform-wide incident, **When** the
   operator views the workspace dashboard, **Then** the dashboard communicates the upstream scope of
   degradation so the issue is not misdiagnosed as workspace-local.

---

### Edge Cases

- A subsystem is healthy, but telemetry ingestion for that subsystem is stale or missing; the
  dashboard must not display stale data as current health.
- A platform-global metric affects tenant experience but is not safe to expose as raw platform
  internals inside tenant/workspace views.
- A subsystem supports tenant attribution but not workspace attribution; the workspace dashboard
  must degrade gracefully and explain the boundary.
- A tenant or workspace is suspended, deleted, or otherwise inactive; the dashboard must indicate
  scope state without implying live service health that no longer applies.
- Partial outages create mixed state across subsystems, where some are healthy, some degraded, and
  some unknown due to missing telemetry.
- Dashboard consumers request a scope they are not authorized to see or that does not belong to the
  stated tenant/workspace relationship.
- Collection lag causes some widgets to reflect different freshness windows than others; the
  dashboard must surface freshness, not silently merge inconsistent time windows.

---

## 5. Functional Requirements

- **FR-001**: The platform MUST define three dashboard scopes for observability health: global,
  tenant, and workspace.
- **FR-002**: The global dashboard MUST summarize the health posture of APISIX, Kafka,
  PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane from the common observability
  plane.
- **FR-003**: Every dashboard scope MUST present, at minimum, normalized signals for availability,
  error posture, latency posture, throughput posture, and observability collection freshness.
- **FR-004**: Dashboard outputs MUST distinguish whether a signal is platform-scoped,
  tenant-scoped, or workspace-scoped according to the scope model established by
  `US-OBS-01-T01`.
- **FR-005**: The tenant dashboard MUST only expose health information attributable to the
  requested tenant and MUST prevent cross-tenant visibility.
- **FR-006**: The workspace dashboard MUST only expose health information safely attributable to the
  requested workspace and MUST not fabricate workspace precision for signals that exist only at
  tenant or platform scope.
- **FR-007**: When a subsystem does not support workspace-safe attribution, the workspace dashboard
  MUST mark that subsystem as inherited from tenant scope, platform-dependent, or unavailable for
  workspace detail.
- **FR-008**: Dashboards MUST surface stale, missing, or failed telemetry collection as an explicit
  health condition and MUST distinguish it from confirmed healthy status.
- **FR-009**: The global dashboard MUST make cross-subsystem degradation visible, including the
  ability to identify which subsystems are degraded, unknown, or healthy in one view.
- **FR-010**: The tenant and workspace dashboards MUST preserve the platform's multi-tenant
  isolation model and authorization boundaries at the presentation layer as well as the query layer.
- **FR-011**: The dashboard capability MUST define the expected drilldown relationship between
  global, tenant, and workspace scopes so downstream console or operational surfaces remain
  behaviorally consistent.
- **FR-012**: Dashboard summaries MUST communicate when a visible issue is inherited from an
  upstream platform-wide condition versus localized to a tenant or workspace.
- **FR-013**: Dashboard definitions MUST indicate the freshness window of the underlying data so
  operators can judge whether the displayed state is current enough for operational use.
- **FR-014**: Access to tenant-scoped and workspace-scoped dashboard views MUST remain attributable
  to the requesting actor and compatible with the platform's audit and traceability model.
- **FR-015**: This task's deliverables MUST provide the canonical dashboard semantics that sibling
  tasks `US-OBS-01-T03` through `US-OBS-01-T06` consume instead of redefining health views.

---

## 6. Business Rules and Governance

- Dashboard scope follows observability scope. Presentation-level aggregation must not weaken the
  tenant and workspace isolation guarantees defined for the metrics plane.
- Tenant-facing and workspace-facing dashboard views must prefer safe omission or explicit
  limitation over speculative or inferred cross-scope data.
- Platform-global issues may be communicated in narrower scopes only in a way that preserves
  operational meaning without leaking platform-internal or other-tenant detail.
- A dashboard health summary is an operational interpretation layer over the common metrics plane;
  it must remain consistent with the normalized metric families and scope labels already defined.
- Collection freshness is part of health governance. Stale telemetry cannot be represented as a
  healthy current state.
- Scope drilldown relationships must remain deterministic so future console work, alerting logic,
  and smoke tests can rely on one canonical hierarchy: global → tenant → workspace.
- Dashboard access for tenant and workspace scopes is security-relevant and must preserve actor,
  tenant, workspace, and correlation context for traceability.

---

## 7. Acceptance Criteria

1. A global dashboard definition exists for the seven required BaaS subsystems.
2. A tenant dashboard definition exists and restricts visible health data to one tenant.
3. A workspace dashboard definition exists and restricts visible health data to one workspace when
   workspace-safe attribution is available.
4. All dashboard scopes include normalized availability, error, latency, throughput, and collection
   freshness dimensions.
5. Dashboard views distinguish platform-scoped, tenant-scoped, and workspace-scoped signals.
6. Stale or failed telemetry collection is represented explicitly as a health condition.
7. The workspace dashboard defines graceful behavior for subsystems that cannot safely expose
   workspace-level attribution.
8. The dashboard model defines how upstream platform incidents are communicated in tenant and
   workspace views without leaking cross-tenant details.
9. The authorization and isolation rules for each dashboard scope are explicit and compatible with
   the platform's multi-tenant governance model.
10. The dashboard model defines a consistent drilldown relationship between global, tenant, and
    workspace scopes.
11. This task does not implement alerting, health endpoints, business metrics, or smoke tests.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- `US-OBS-01-T01` remains the authoritative source for normalized metric families, scope labels,
  collection-health signals, and subsystem coverage.
- At least some signals for APISIX, storage, OpenWhisk, and control-plane operations can be safely
  attributed at tenant or workspace scope through the platform-managed context model.
- Future implementation work can express dashboard semantics without requiring new public API
  contracts in this task.
- Downstream console and alerting work will reuse the same global → tenant → workspace hierarchy
  rather than inventing separate health views.

### Risks

- **False precision risk**: some subsystems may not support safe workspace attribution, tempting
  downstream work to overstate workspace-level detail.
- **Scope confusion risk**: platform-global incidents may be misread as tenant- or workspace-local
  unless the dashboard semantics clearly explain inherited degradation.
- **Telemetry freshness risk**: dashboards can become misleading if stale collection is not treated
  as an explicit health state.
- **Presentation leak risk**: even when raw queries are secure, poorly defined dashboard summaries
  could accidentally expose cross-tenant context through aggregation or comparative widgets.

### Open Questions

- No blocker-level open question prevents specification from proceeding. The main implementation
  follow-up is deciding how the canonical dashboard semantics are represented in machine-readable
  contracts and summary helpers without expanding into UI-specific concerns.

---

## 9. Success Criteria

- **SC-001**: An SRE can assess platform-wide health for all seven BaaS subsystems from one
  normalized dashboard surface without constructing raw metric queries manually.
- **SC-002**: A tenant-scoped health view can be presented without exposing another tenant's
  operational data.
- **SC-003**: A workspace-scoped health view can distinguish workspace-local, tenant-inherited, and
  platform-inherited degradation states without claiming unsupported precision.
- **SC-004**: Operators can tell whether a dashboard state is current, stale, or based on failed
  telemetry collection.
- **SC-005**: Downstream observability tasks can reuse one canonical dashboard model instead of
  redefining scope semantics independently.
