# Feature Specification: Plan Change History & Effective Quota Impact

**Feature Branch**: `100-plan-change-impact-history`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Persistir histórico de cambios de plan y su impacto sobre cuotas efectivas"  
**Task ID**: US-PLAN-01-T04  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (097-plan-entity-tenant-assignment), US-PLAN-01-T02 (098-plan-base-limits), US-PLAN-01-T03 (099-plan-management-api-console)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Superadmin Reviews the Full Impact of a Plan Change (Priority: P1)

A superadmin changes a tenant from one plan to another and can later review a durable history entry that shows not only which plan changed, but also how the tenant's effective quota posture changed as a result. The record clearly distinguishes increases, decreases, unchanged dimensions, gained or lost capabilities, and whether any current tenant consumption now exceeds the newly effective limits.

**Why this priority**: Changing a tenant's plan without preserving the impact of that change creates audit gaps, support ambiguity, and commercial risk. Operators need a trustworthy record of what the change meant at the moment it took effect.

**Independent Test**: Can be fully tested by changing a tenant from one plan to another, then querying the resulting history entry and verifying it contains the previous plan, new plan, effective timestamp, actor, and a complete impact summary for capabilities and quota dimensions.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` moves from `starter` to `professional`, **When** the plan change is completed, **Then** the system persists a history entry containing the previous plan, the new plan, the actor, the effective timestamp, and the delta for every relevant capability and quota dimension.
2. **Given** tenant `acme-corp` moves from `professional` to `starter`, **When** the history entry is queried later, **Then** the response clearly identifies which limits decreased, which remained unchanged, and which current resource counts are now above the newly effective limits.
3. **Given** a plan change occurs, **When** finance or product operations reviews the tenant's plan history, **Then** they can understand the business impact of the change without reconstructing old plan definitions manually.

---

### User Story 2 — Tenant Owner Understands Current Effective Entitlements After a Plan Change (Priority: P1)

A tenant owner views their current plan state after an upgrade or downgrade and sees the effective quota posture now applied to their tenant, including inherited base limits from the assigned plan and any supported overrides already in force. They can also understand whether they are within limits, approaching limits, or already above a newly reduced limit.

**Why this priority**: Plan changes directly affect tenant expectations and operational behavior. Tenant owners need immediate clarity about their current entitlements and whether a downgrade created follow-up work.

**Independent Test**: Can be fully tested by changing a tenant's plan, then querying the tenant's effective quota summary and verifying it reflects the new plan change with correct effective values and current usage status.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is downgraded to a plan with lower workspace and API key limits, **When** the tenant owner views the effective quota summary, **Then** the summary shows the newly effective limits and indicates any dimensions currently above those limits.
2. **Given** tenant `acme-corp` is upgraded to a plan with higher storage and function limits, **When** the tenant owner views the effective quota summary, **Then** the summary shows the increased effective limits and indicates that no over-limit condition exists for those dimensions.
3. **Given** a quota dimension is unchanged by the plan change, **When** the tenant owner reviews the change impact, **Then** that dimension is shown as unchanged rather than omitted.

---

### User Story 3 — Support or Compliance Audits Plan Change Decisions Over Time (Priority: P2)

An authorized internal operator reviews the chronological history of plan changes for a tenant to answer support, finance, or compliance questions. Each entry explains when the change happened, who triggered it, what effective entitlements changed, and what the tenant's resource posture was at that moment.

**Why this priority**: Historical traceability is essential for dispute resolution and compliance reviews, but it depends on plan changes already being recorded with sufficient context.

**Independent Test**: Can be fully tested by performing multiple upgrades and downgrades for the same tenant, then retrieving the ordered history and verifying that each entry retains its original impact snapshot even if plan definitions change later.

**Acceptance Scenarios**:

1. **Given** a tenant has undergone several upgrades and downgrades, **When** an authorized operator queries plan change history, **Then** each entry is returned in chronological order with its original impact snapshot preserved.
2. **Given** a plan definition is edited after a tenant changed plans, **When** an older history entry is reviewed, **Then** the entry still shows the effective quota and capability impact that applied when the change originally took effect.
3. **Given** an operator filters history by date range or actor, **When** matching events exist, **Then** the system returns only the entries within scope while preserving the full impact detail for each result.

---

### User Story 4 — Product or Finance Operations Detect Downgrade Risk (Priority: P2)

A product operations or finance user reviews downgrade history to identify where a tenant accepted a plan with lower entitlements than their current consumption. The history makes clear which dimensions exceeded the new effective limits at the time of change so the business can apply transition or overage policies later.

**Why this priority**: Downgrades can create operational and commercial risk. Capturing risk at the time of change prevents later ambiguity and supports downstream policy work without requiring this feature to enforce those policies.

**Independent Test**: Can be fully tested by downgrading a tenant that already consumes more than the target plan allows, then verifying the history entry explicitly marks the affected dimensions as over-limit at the effective time.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` already has 8 workspaces and the target plan allows 5, **When** the downgrade is completed, **Then** the persisted impact entry marks `max_workspaces` as over-limit-at-change with the effective limit of 5 and observed usage of 8.
2. **Given** a downgrade reduces some limits but current usage remains below the new thresholds, **When** the impact entry is recorded, **Then** the entry shows the decreases but does not mark those dimensions as over-limit.

### Edge Cases

- What happens when a tenant changes to a plan whose quota dimensions differ from the previous plan? The history entry must include dimensions that were added, removed, increased, decreased, or unchanged so the comparison is complete.
- What happens when the target plan uses inherited platform defaults for some dimensions? The persisted impact must record the effective value that actually applied at change time, not merely that the value was inherited.
- What happens when a dimension is unlimited before or after the change? The comparison must represent unlimited explicitly and distinguish it from zero or a finite value.
- What happens when current usage cannot be determined for a specific dimension at the moment of plan change? The impact entry records the dimension change and marks usage status for that dimension as unavailable rather than guessing.
- What happens when two operators attempt to change the same tenant's plan concurrently? Only the successful change may generate a new impact history entry; rejected or superseded attempts must not create duplicate impact records.
- What happens when a plan change results in no effective difference because the old and new plans resolve to the same effective entitlements? The change is still recorded, but the impact summary marks all dimensions and capabilities as unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST persist a durable **plan change history entry** each time a tenant's current plan assignment changes.
- **FR-002**: Each plan change history entry MUST include, at minimum: tenant identifier, previous plan identifier, new plan identifier, actor identifier, effective timestamp, correlation identifier, and the reason or source of change when supplied by the initiating workflow.
- **FR-003**: Each plan change history entry MUST persist an **impact snapshot** describing the tenant's effective entitlement posture at the time of change, including all relevant quota dimensions and declared capabilities.
- **FR-004**: For every quota dimension included in the impact snapshot, the system MUST store the previous effective value, the new effective value, and a comparison classification of `increased`, `decreased`, `unchanged`, `added`, or `removed`.
- **FR-005**: For every capability included in the impact snapshot, the system MUST store the previous effective state, the new effective state, and a comparison classification of `enabled`, `disabled`, or `unchanged`.
- **FR-006**: The impact snapshot MUST record the effective quota values that actually applied to the tenant at the moment of change, including inherited defaults and any supported tenant-specific adjustments already in force.
- **FR-007**: The system MUST capture, for each quota dimension in the impact snapshot, the tenant's observed usage state at the moment of change when that usage is available.
- **FR-008**: When observed usage is available, the system MUST classify each quota dimension after the change as `within_limit`, `at_limit`, or `over_limit` relative to the new effective value. When usage is unavailable, the status MUST be recorded as `unknown`.
- **FR-009**: The system MUST preserve each impact snapshot immutably so later edits to plan definitions, platform defaults, or tenant adjustments do not rewrite past plan change history.
- **FR-010**: Authorized platform operators MUST be able to query a tenant's plan change history with each entry's full impact snapshot.
- **FR-011**: Tenant owners MUST be able to view the current effective entitlement summary for their own tenant after a plan change, including the current effective value and present usage status for each quota dimension.
- **FR-012**: The system MUST support filtering plan change history by tenant, date range, and actor for authorized internal users.
- **FR-013**: Only a successful committed plan change may create a plan change history entry. Failed, rejected, or rolled-back plan change attempts MUST NOT create durable impact history.
- **FR-014**: All reads and writes for plan change history and effective entitlement summaries MUST respect multi-tenant isolation. Tenant owners may only access their own tenant's information; privileged internal roles may access tenant histories according to their authorization scope.
- **FR-015**: Every persisted plan change history entry MUST emit an auditable event indicating that the change and impact snapshot were recorded.
- **FR-016**: The system MUST present over-limit conditions caused by a downgrade as informational state for traceability; this feature MUST NOT by itself enforce remediation, block the downgrade, or define overage policy.
- **FR-017**: The system MUST return history entries in stable chronological order and support pagination when a tenant has many plan changes.
- **FR-018**: The system MUST preserve both changed and unchanged dimensions in the impact snapshot so reviewers can see the full effective entitlement posture rather than only partial deltas.

### Key Entities

- **Plan Change History Entry**: Immutable record of a committed tenant plan change, including tenant, previous plan, new plan, actor, timestamp, correlation identifier, and a full impact snapshot.
- **Effective Entitlement Snapshot**: Point-in-time representation of the effective capabilities and quota values that applied to the tenant when the plan change took effect, including inherited defaults and supported adjustments already resolved.
- **Quota Impact Line Item**: Per-dimension comparison record showing previous effective value, new effective value, comparison classification, observed usage at change time when available, and resulting post-change status (`within_limit`, `at_limit`, `over_limit`, or `unknown`).
- **Capability Impact Line Item**: Per-capability comparison record showing previous state, new state, and whether the capability was enabled, disabled, or unchanged by the plan change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful tenant plan changes create exactly one durable history entry with actor, timestamp, previous plan, new plan, and full impact snapshot.
- **SC-002**: Authorized operators can retrieve the full plan change history for any tenant, including impact snapshots, in under 5 seconds for tenants with up to 500 recorded changes.
- **SC-003**: 100% of history entries remain historically accurate after later edits to plan definitions or platform default quota values.
- **SC-004**: For every quota dimension whose usage is available at change time, the system classifies post-change status (`within_limit`, `at_limit`, `over_limit`) correctly and consistently.
- **SC-005**: Tenant owners can view their current effective entitlement summary within 10 seconds of a completed plan change.
- **SC-006**: No tenant owner can access another tenant's history or effective entitlement summary.
- **SC-007**: Downgrade events that place a tenant above one or more new effective limits are visible to authorized reviewers without requiring manual comparison of historical plan data.

## Assumptions

- The tenant domain and current plan assignment model already exist from US-DOM-02 and US-PLAN-01-T01.
- Base quota dimensions and plan-level limits already exist from US-PLAN-01-T02.
- Plan assignment and viewing flows already exist from US-PLAN-01-T03.
- The platform can already determine current usage for at least some quota dimensions, but availability may vary by dimension; unavailable usage should be represented explicitly rather than inferred.
- Tenant-specific adjustments or overrides may exist now or later; this feature must snapshot whatever effective entitlement values are actually resolved at change time without defining the override model itself.
- Enforcement of hard or soft limits, grace periods, transition policy, and remediation workflows remains outside the scope of this task and belongs to follow-on backlog items.

## Scope Boundaries

### In Scope

- Persisting immutable history for successful tenant plan changes
- Capturing point-in-time impact snapshots for capabilities and effective quota values
- Recording post-change usage posture (`within_limit`, `at_limit`, `over_limit`, `unknown`) per dimension when usage data is available
- Querying plan change history for authorized internal users
- Showing the tenant's current effective entitlement summary after a plan change
- Multi-tenant isolation, traceability, and auditability for the above

### Out of Scope

- Defining or enforcing hard vs. soft quota policy
- Blocking downgrades because a tenant is already above a new limit
- Billing, invoicing, refunds, or commercial approval workflows
- Automated remediation, resource deletion, or migration actions triggered by a downgrade
- Upgrade/downgrade test execution (US-PLAN-01-T05)
- Transition policy documentation and overage handling rules (US-PLAN-01-T06)
- Redesigning the underlying plan entity, base limit catalog, or plan management UI introduced in T01-T03
