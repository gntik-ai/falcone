# Feature Specification: US-STO-02-T05 — Storage Provider Capability Exposure

**Feature Branch**: `017-storage-provider-capabilities`  
**Task**: US-STO-02-T05  
**Epic**: EP-12 — Storage S3-compatible  
**Story**: US-STO-02 — Multipart, presigned URLs, políticas, cuotas, eventos y capabilities de provider  
**Created**: 2026-03-28  
**Status**: Implemented

---

## 1. Objective and Problem Statement

The storage module already models provider selection, baseline compatibility, multipart/presigned support, bucket policies, quota guardrails, and event-notification previews. What is still missing is an explicit, reusable way to expose **advanced provider capabilities** for the provider currently selected by configuration.

This task adds a bounded capability-publication layer that declares whether the selected storage provider supports, partially supports, or does not support the following advanced capabilities:

- object versioning
- bucket lifecycle rules
- object lock / immutability controls
- bucket event notifications
- bucket policies

Without this task, downstream storage features must infer support indirectly from implementation details or assume parity across providers. That creates hidden provider coupling, weakens graceful degradation, and makes operator-facing introspection incomplete.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Workspace admins** need to understand which advanced storage features are safe to enable for the current provider.
- **Tenant owners** need capability exposure to remain explicit, auditable, and stable across provider choices.
- **Developers** need one deterministic source of truth for provider-dependent feature gates instead of scattered implicit checks.
- **Service accounts** need machine-readable capability declarations when orchestrating storage workflows programmatically.
- **Superadmins** need to explain support gaps and provider limitations without inspecting provider-specific implementation details.

### Value delivered

- Makes advanced-provider support explicit rather than implicit.
- Reduces accidental coupling between storage features and one specific S3-compatible backend.
- Enables later graceful-degradation and compatibility-test work without redesigning provider introspection.
- Improves traceability for tenant-governed storage behavior.

---

## 3. In-Scope Capability

This task covers a **repo-local, additive, declarative provider-capability surface** for advanced storage features.

### In scope

- Publish explicit advanced capability declarations for the selected provider.
- Cover these capability IDs in the provider profile and compatibility surface:
  - `object.versioning`
  - `bucket.lifecycle`
  - `object.lock`
  - `bucket.event_notifications`
  - `bucket.policy`
- Preserve the existing baseline capability profile and extend it additively.
- Expose capability state as one of:
  - `satisfied`
  - `partially_satisfied`
  - `unsatisfied`
- Include bounded summaries and constraints for advanced capabilities when relevant.
- Make capability exposure available through the existing storage provider introspection surfaces used by adapter and control-plane helpers.
- Ensure unsupported or partially supported capabilities degrade explicitly rather than disappearing from the profile.

### Out of scope

- Implementing provider-native lifecycle, versioning, object-lock, or event-notification mutations.
- Executing live provider API calls.
- Changing storage quotas, bucket-policy enforcement semantics, or event-delivery behavior already covered by earlier tasks.
- Broad degradation matrix coverage from `US-STO-02-T06`.
- UI screens, dashboards, or console workflows.

---

## User Scenarios & Testing

### User Story 1 — Operator inspects advanced capabilities for the selected provider (Priority: P1)

A workspace admin or tenant owner can inspect the currently selected provider and see a declarative advanced-capability profile covering versioning, lifecycle, object lock, event notifications, and bucket policies.

**Why this priority**: Explicit support visibility is the core user-facing outcome of the task.

**Independent Test**: Build a provider profile for each supported provider and verify that the advanced-capability IDs are always present with stable states, summaries, and constraints where applicable.

---

### User Story 2 — Downstream storage flows can gate advanced features using one explicit source (Priority: P1)

A downstream module can consume the provider profile and determine whether an advanced storage feature is supported, partially supported, or unsupported without reverse-engineering provider type names.

**Why this priority**: This makes later tasks and future features safer and less provider-coupled.

**Independent Test**: Request the advanced capability surface from the provider catalog and confirm the returned declarations are deterministic and additive for the selected provider.

---

### User Story 3 — Unsupported capabilities remain visible and explainable (Priority: P2)

A superadmin can see that unsupported or deployment-dependent capabilities are explicitly reported, including limitations and constraints, instead of being silently omitted.

**Why this priority**: Explicit unsupported states are required for graceful degradation and operator support.

**Independent Test**: Verify that a provider with partial or missing support still publishes all advanced capability IDs and includes limitation metadata where the profile cannot fully satisfy the capability.

---

## 4. Functional Requirements

### FR-001 — Declarative advanced capability publication

The system MUST expose the selected provider’s advanced capability surface declaratively and MUST NOT require consumers to infer support from provider type names or unrelated implementation details.

### FR-002 — Stable advanced capability catalog

The system MUST publish these advanced capability IDs for every selected or enumerated supported provider:

- `object.versioning`
- `bucket.lifecycle`
- `object.lock`
- `bucket.event_notifications`
- `bucket.policy`

Each capability MUST always appear in the provider capability detail surface even when unsupported.

### FR-003 — Explicit support state

Each advanced capability MUST declare one explicit state from the existing catalog:

- `satisfied`
- `partially_satisfied`
- `unsatisfied`

### FR-004 — Additive manifest exposure

The provider capability manifest MUST expose boolean summary fields for the advanced capabilities in addition to the existing baseline and previously added optional capabilities.

### FR-005 — Constraint visibility

When an advanced capability is partially supported or subject to provider-specific limits, the declaration MUST expose bounded constraint metadata and/or limitation summaries that explain the condition without leaking secrets or provider credentials.

### FR-006 — Introspection compatibility

The existing provider introspection and compatibility helpers MUST expose the extended advanced-capability profile without breaking their current baseline compatibility behavior.

### FR-007 — Explicit unavailable behavior

If provider selection is missing, ambiguous, unknown, or otherwise unavailable, the provider profile MUST still expose the advanced capability catalog with explicit unavailable/unsatisfied semantics rather than omitting advanced capability fields.

### FR-008 — Tenant-safe and audit-safe output

Capability exposure MUST remain safe for tenant-facing introspection. The output MUST NOT include provider credentials, endpoints, secret references, or provider-native control-plane details that are not required to understand capability posture.

### FR-009 — Future-feature readiness

The capability publication surface MUST be suitable for downstream feature gating by later storage capabilities and for degradation tests in `US-STO-02-T06` without requiring redesign of the capability identifiers or state semantics.

---

## 5. Business Rules and Governance

- Advanced capability support is declarative metadata, not runtime proof that a live provider is correctly configured.
- Partial support is valid and must remain visible instead of being coerced into either fully supported or unsupported.
- Capabilities with deployment-dependent behavior must explicitly communicate that dependency through constraints or limitations.
- Provider selection errors remain modeled through the existing unavailable profile flow and must not bypass the explicit capability surface.
- Capability exposure is shared platform metadata and does not grant permission to execute the associated advanced operation.

---

## 6. Edge Cases

- **Missing provider selection**: the profile remains unavailable, but the advanced capability catalog is still structurally present and safely unsatisfied.
- **Ambiguous provider selection**: multiple conflicting provider selections produce an unavailable profile and no implicit capability assumption.
- **Unknown provider type**: the profile remains unavailable and does not claim advanced support.
- **Deployment-dependent support**: capabilities such as versioning, lifecycle, object lock, or event notifications may be published as partially satisfied with constraints.
- **Provider-specific gaps**: unsupported advanced capabilities remain visible with an explicit unsatisfied state and limitation summary.

---

## 7. Acceptance Criteria

1. The selected provider profile includes explicit declarations for `object.versioning`, `bucket.lifecycle`, `object.lock`, `bucket.event_notifications`, and `bucket.policy`.
2. The provider capability manifest includes additive boolean summary fields for the new advanced capabilities.
3. Provider catalog and control-plane introspection helpers expose the extended capability surface without removing existing fields.
4. At least one supported provider demonstrates a capability with `partially_satisfied` or `unsatisfied` state, proving the surface handles graceful degradation declaratively.
5. Unsupported or unavailable provider-selection cases still return a stable capability surface with safe unsupported semantics.
6. Capability exposure remains secret-safe and credential-free.
7. Automated unit/adapter/contract coverage verifies the advanced-capability catalog, manifest fields, and representative provider-state differences.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The repository continues treating provider capability publication as a declarative compatibility layer, not as live provider interrogation.
- Existing storage feature modules will consume the explicit capability profile incrementally rather than requiring immediate refactors in this task.

### Risks

- Overstating support for a provider could create false confidence for later feature work.
- Under-specifying partial-support constraints could make graceful degradation harder in later tasks.

### Blocking questions

No blocking questions are currently identified. This task can proceed with bounded declarative provider metadata based on the repository’s existing abstraction approach.

---

## 9. Success Metrics

- Advanced capability exposure is deterministic for all supported providers.
- Downstream code can feature-gate advanced storage behavior using capability IDs and states instead of provider-name branching.
- The extended provider profile remains additive, secret-safe, and testable through existing adapter/control-plane helper surfaces.
