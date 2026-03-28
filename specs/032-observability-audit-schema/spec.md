# Feature Specification: US-OBS-02-T02 — Canonical Audit Event Schema

**Feature Branch**: `032-observability-audit-schema`
**Task**: `US-OBS-02-T02`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020
**Dependencies**: US-ARC-03, US-PRG-03
**Intra-story dependency**: US-OBS-02-T01
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

`US-OBS-02-T01` established the common audit pipeline: which subsystems must emit audit events, how events move through Kafka, how tenant isolation is preserved, and how pipeline health is observed.

What is still missing is the **canonical event schema** for each audit record.

Without a shared schema:

- each subsystem could emit different field names and incompatible payload shapes,
- downstream work cannot build stable query, export, masking, or correlation behavior,
- security reviewers cannot verify whether every event carries the minimum identity, scope, resource, action, result, and traceability context,
- and platform operators cannot distinguish between a missing field, an intentionally omitted optional field, and a malformed audit record.

This task defines the bounded, machine-readable **audit event schema baseline** that every administrative audit event must follow. The schema standardizes the required envelope for actor, timestamp, tenant, workspace, resource, action, result, correlation, and origin while remaining compatible with the pipeline contract delivered in `US-OBS-02-T01`.

This task does **not** implement query APIs (`T03`), export or masking behavior (`T04`), cross-system action correlation (`T05`), or end-to-end traceability verification (`T06`). It only defines the canonical event shape and the validation rules that later tasks must consume.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Security and compliance reviewers** need a stable, reviewable event schema so they can verify every administrative event carries minimum accountability fields.
- **Superadmins and SREs** need every subsystem to emit records with the same normalized envelope so incidents and audits can be reasoned about consistently.
- **Downstream audit feature implementors** need a canonical schema before they can safely build filtering, export, masking, and correlation features.
- **Provider adapter and control-plane authors** need a single field contract instead of inventing subsystem-specific audit payloads.

### Indirect consumers

- **Tenant owners** benefit because scope fields become explicit and verifiable, reducing the chance of audit records being emitted without tenant or workspace context.
- **Console and platform workflow authors** benefit because future correlation work can assume a consistent `correlation_id` and `origin` envelope.

### Value delivered

- Standardizes the minimum audit event shape for every emitting subsystem.
- Makes required scope and traceability fields explicit and validatable.
- Enables later work to build query, export, masking, and correlation on a stable contract.
- Prevents silent schema drift across IAM, databases, events, functions, storage, quotas, and control-plane operations.

---

## 3. In-Scope Capability

### In scope

- Define a canonical audit event schema contract as a machine-readable artifact.
- Standardize the required top-level audit envelope for:
  - event identity,
  - actor,
  - event timestamp,
  - tenant and workspace scope,
  - affected resource,
  - action and normalized category,
  - result,
  - correlation identifier,
  - origin metadata.
- Define which fields are always required, which are conditionally required, and which remain optional.
- Define the normalized vocabulary for actor types, action categories, result statuses, and origin surfaces.
- Align the schema with `US-OBS-02-T01` so all event categories required by the pipeline can be represented by the event schema.
- Define contract readers/accessors and deterministic validation for the schema baseline.
- Document the bounded T02 scope and how later tasks depend on it.

### Out of scope

- Audit query/filter APIs or route design (`US-OBS-02-T03`).
- Export bundles, retention exports, or data masking execution (`US-OBS-02-T04`).
- Console-to-backend or backend-to-provider correlation behavior beyond defining the required `correlation_id` and `origin` fields (`US-OBS-02-T05`).
- End-to-end traceability tests across multiple subsystems (`US-OBS-02-T06`).
- Runtime emitters, Kafka consumers, durable-store schema migrations, or storage adapters.
- Sensitive-field masking policy logic beyond naming the schema fields that later masking work must classify.

---

## 4. User Scenarios & Testing

### User Story 1 — Review one canonical audit envelope (Priority: P1)

As a security reviewer, I need one shared audit-event schema for all platform subsystems so that I can verify which accountability fields must always be present in every administrative record.

**Why this priority**: Without a common envelope, downstream audit behavior becomes subsystem-specific and non-reviewable.

**Independent Test**: A reviewer can inspect the contract and confirm it defines one normalized event shape with required actor, timestamp, scope, resource, action, result, correlation, and origin sections.

**Acceptance Scenarios**:

1. **Given** the audit event schema contract exists, **when** a reviewer inspects the required field inventory, **then** it explicitly includes actor, event timestamp, tenant scope, resource, action, result, correlation id, and origin metadata.
2. **Given** an event omits a required field such as `correlation_id` or `action`, **when** schema validation runs, **then** the validation fails with a specific violation message.
3. **Given** different subsystems emit audit records, **when** they are compared against the schema, **then** they share the same top-level audit envelope even if subsystem-specific details differ.

---

### User Story 2 — Preserve tenant and workspace accountability (Priority: P1)

As a superadmin, I need the schema to standardize tenant and workspace attribution so that audit records can be isolated and reviewed safely in a multi-tenant platform.

**Why this priority**: Audit events without explicit scope create blind spots and increase the risk of cross-tenant ambiguity.

**Independent Test**: A reviewer can inspect the schema and confirm that tenant attribution rules, workspace optionality, and platform-scope handling are explicitly defined.

**Acceptance Scenarios**:

1. **Given** a tenant-scoped administrative event, **when** it is represented by the schema, **then** `tenant_id` is required and `workspace_id` is allowed when the subsystem can safely attribute workspace scope.
2. **Given** a platform-scoped event, **when** it is represented by the schema, **then** the schema permits a platform scope without fabricating tenant or workspace ownership.
3. **Given** a subsystem emits a workspace-aware event without `workspace_id`, **when** validation runs, **then** the schema rules make clear whether the omission is allowed or invalid for that scope profile.

---

### User Story 3 — Normalize action and outcome semantics (Priority: P1)

As an audit feature implementor, I need standardized action categories and result statuses so that later query, export, and correlation features do not need to infer meaning from subsystem-specific strings.

**Why this priority**: Future tasks cannot build reliable filtering or reporting on free-form action/result values.

**Independent Test**: A reviewer can inspect the contract and confirm it defines normalized action categories aligned with `US-OBS-02-T01`, plus an explicit result vocabulary for success, failure, denial, and partial outcomes.

**Acceptance Scenarios**:

1. **Given** the pipeline contract requires `configuration_change` and `access_control_modification` categories, **when** the event schema action vocabulary is inspected, **then** both categories are supported.
2. **Given** an audit record reports an administrative action outcome, **when** the result section is inspected, **then** it uses a defined result vocabulary rather than free-form status text.
3. **Given** a subsystem introduces a category not covered by the schema vocabulary, **when** validation runs, **then** the mismatch is surfaced as a specific contract violation.

---

### User Story 4 — Capture traceability without implementing correlation yet (Priority: P2)

As a platform operator, I need every audit event to carry a required `correlation_id` and normalized origin metadata so that later tasks can reconstruct end-to-end action traces without redefining the event envelope.

**Why this priority**: Even before T05 implements correlation behavior, the schema must reserve the traceability fields that all producers and consumers will rely on.

**Independent Test**: A reviewer can inspect the schema and confirm that `correlation_id` is required for every event and that origin metadata is standardized.

**Acceptance Scenarios**:

1. **Given** an audit event is emitted by the control plane, **when** its envelope is validated, **then** `correlation_id` and `origin` are required.
2. **Given** an event originates from a known initiating surface such as control API or console backend, **when** its origin section is inspected, **then** the schema captures the normalized origin surface value.
3. **Given** an event lacks origin metadata, **when** validation runs, **then** the contract fails rather than silently accepting an untraceable record.

---

## 5. Edge Cases

- What happens when an event is platform-scoped rather than tenant-scoped? The schema must allow a platform scope profile and must not fabricate tenant or workspace identifiers.
- What happens when a subsystem cannot attribute workspace scope? The schema must allow `workspace_id` to be absent while keeping `tenant_id` and other accountability fields intact.
- What happens when an action produces a partially applied administrative result? The schema must support a bounded `partial` or equivalent normalized outcome without requiring downstream correlation logic.
- What happens when a record references a resource type but not a stable resource identifier? The schema must define whether `resource_id` is required, conditionally required, or replaced by a bounded alternate reference field.
- What happens when a subsystem wants to add subsystem-specific detail fields? The canonical envelope must permit a bounded extension area without weakening the required common fields.
- What happens when an event category exists in the pipeline contract but is missing from the schema vocabulary? Validation must fail deterministically.
- What happens when a record includes sensitive detail values? This task does not define masking, but the schema must separate the common envelope from optional detail payloads so later masking work can classify them safely.

---

## 6. Requirements

### Functional Requirements

- **FR-001**: The platform MUST define a machine-readable canonical audit event schema contract for administrative events.
- **FR-002**: The audit event schema MUST require a stable event identity field and a non-empty schema `version`.
- **FR-003**: The audit event schema MUST require an event timestamp field that represents when the audited action was recorded.
- **FR-004**: The audit event schema MUST require an `actor` section containing at least the normalized actor identifier and actor type.
- **FR-005**: The audit event schema MUST require a `scope` section capable of representing tenant-scoped, workspace-scoped, and platform-scoped events.
- **FR-006**: The audit event schema MUST require a `resource` section identifying the affected subsystem and resource kind, and it MUST define whether a stable `resource_id` is required or conditionally required.
- **FR-007**: The audit event schema MUST require an `action` section with a normalized action identifier and a normalized category vocabulary compatible with the event categories declared by `US-OBS-02-T01`.
- **FR-008**: The audit event schema MUST require a `result` section with an explicit normalized outcome vocabulary.
- **FR-009**: The audit event schema MUST require `correlation_id` for every audit event.
- **FR-010**: The audit event schema MUST require an `origin` section that standardizes where the audited action originated.
- **FR-011**: The audit event schema MUST distinguish between always-required fields, conditionally required fields, and optional fields.
- **FR-012**: The audit event schema MUST define normalized vocabularies for actor type, action category, result status, and origin surface.
- **FR-013**: The schema validation logic MUST fail deterministically when a required field definition is missing, when a required vocabulary entry is missing, or when source-contract versions are out of alignment.
- **FR-014**: The schema contract MUST declare a source reference to the audit pipeline contract from `US-OBS-02-T01` so compatibility can be validated.
- **FR-015**: The schema contract MUST reserve a bounded extension area for subsystem-specific details without weakening the required canonical envelope.
- **FR-016**: The schema contract MUST NOT define query filters, export bundle structure, masking execution rules, or correlation workflows in this increment.

### Key Entities

- **Audit Event Envelope**: The canonical top-level shape shared by all administrative audit records.
- **Audit Actor**: The normalized identity of the actor that initiated the action, including actor type and identifier.
- **Audit Scope**: The tenant/workspace/platform attribution block used to preserve multi-tenant accountability.
- **Audit Resource**: The normalized description of the affected subsystem and managed resource.
- **Audit Action**: The normalized action and category semantics for the audited operation.
- **Audit Result**: The normalized outcome block describing whether the action succeeded, failed, was denied, or only partially completed.
- **Audit Origin**: The standardized metadata describing where the action came from.
- **Audit Detail Extension**: The bounded optional area where subsystem-specific fields may appear without redefining the envelope.

---

## 7. Isolation, Audit, and Security Constraints

- Tenant and workspace attribution rules MUST remain compatible with the tenant-isolation guarantees defined in `US-OBS-02-T01`.
- The schema MUST allow platform-scoped events without overloading tenant-scoped fields.
- `correlation_id` MUST be mandatory so later traceability and correlation work can operate on a stable field.
- The schema MUST not make sensitive-field masking decisions in this task, but it MUST separate the canonical envelope from optional detail payloads so later masking work can classify fields cleanly.
- Origin metadata MUST be normalized and bounded; free-form origin strings are not acceptable as the only origin representation.
- The schema MUST remain additive and forward-compatible so later tasks can extend behavior without breaking already emitted canonical fields.

---

## 8. Success Criteria

### Measurable Outcomes

- **SC-001**: A reviewer can inspect one contract artifact and identify the full canonical audit event envelope, including actor, timestamp, scope, resource, action, result, `correlation_id`, and origin.
- **SC-002**: Validation fails with a specific message if any required canonical field definition is removed from the schema contract.
- **SC-003**: Validation fails with a specific message if the audit schema omits a normalized action category required by the pipeline contract from `US-OBS-02-T01`.
- **SC-004**: The shared reader/accessor layer exposes the audit event schema contract and its main sections for test and downstream consumer use.
- **SC-005**: The task summary and architecture index clearly document that this increment defines the canonical event schema only and leaves query, export, masking, and correlation to later tasks.
- **SC-006**: Downstream tasks `US-OBS-02-T03` through `US-OBS-02-T06` can reference this schema contract without redefining the common event envelope.

---

## 9. Backlog Traceability

| Field | Value |
|---|---|
| **Task ID** | US-OBS-02-T02 |
| **Epic** | EP-13 — Cuotas, metering, auditoría y observabilidad |
| **Story** | US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación |
| **Story type** | Feature |
| **Story priority** | P0 |
| **Story size** | L |
| **Covered RFs** | RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020 |
| **Story dependencies** | US-ARC-03, US-PRG-03 |
| **Intra-story dependencies** | US-OBS-02-T01 |
| **Immediate downstream dependents** | US-OBS-02-T03, US-OBS-02-T04, US-OBS-02-T05, US-OBS-02-T06 |
| **Upstream baseline consumed** | US-OBS-02-T01 common audit pipeline contract |
