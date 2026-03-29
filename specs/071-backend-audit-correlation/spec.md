# Feature Specification: Console Backend Audit and Correlation

**Feature Branch**: `071-backend-audit-correlation`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Asegurar que las funciones backend registran auditoría y correlation-id."

**Backlog Traceability**:
- **Task**: US-UIB-01-T05
- **Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura
- **Epic**: EP-16 — Backend funcional de la consola
- **RFs covered by story**: RF-UIB-001, RF-UIB-002, RF-UIB-003, RF-UIB-004, RF-UIB-005
- **Story dependencies**: US-FN-03, US-UI-01, US-TEN-01
- **Task dependencies**: US-UIB-01-T01 (workflow catalog), US-UIB-01-T02 (backend workflow functions), US-UIB-01-T03 (endpoint separation), US-UIB-01-T04 (saga/compensation)

**Compatibility note**: This task is intentionally narrow. It assumes the console workflow functions already exist as governed backend executions and focuses only on making those executions traceable through audit records and a stable correlation identifier. It must remain compatible with the canonical audit and observability work already established elsewhere in the platform, and it must not redefine workflow cataloging, endpoint classification, saga behavior, or end-to-end test coverage.

## 1. Objective and Problem Statement

When a console user triggers a backend workflow, the platform needs a reliable way to answer three operational questions:

1. **What action was started?**
2. **Which downstream changes belong to that one request?**
3. **How can a tenant operator or auditor prove what happened later?**

Without a shared correlation identifier and consistent audit registration, a successful workflow can look indistinguishable from a failed or partial one, support teams must piece together evidence manually, and security reviewers cannot confidently tie downstream activity back to the original console action.

This task delivers the minimum functional capability for **traceable console backend workflows**: every workflow execution is linked to a correlation identifier, every significant workflow milestone is recorded in audit, and the resulting trace can be used by authorized users to reconstruct the workflow lifecycle.

This task does **not** define new audit schemas, export flows, compensation logic, UI screens, or end-to-end test suites. Those are handled by other platform work.

## 2. Users, Consumers, and Value

### Direct consumers

- **Tenant owners** need confidence that tenant-level console actions can be traced later if a provisioning or administrative issue occurs.
- **Workspace admins** need to review the history of workspace-level actions and verify which request caused a change.
- **Superadmins** need a clear trace for high-impact administrative operations across tenants.
- **Security, compliance, and SRE operators** need a dependable audit trail that groups related events under one correlation identifier.

### Value delivered

- A single console action can be traced from initiation to terminal outcome.
- Support teams can investigate issues without guessing which events belong together.
- Audit evidence stays tied to the correct tenant and workspace context.
- Users receive a consistent reference that can be shared with operators during troubleshooting.

## 3. User Scenarios & Testing *(mandatory)*

### User Story 1 — Every backend workflow starts with a traceable correlation identifier (Priority: P1)

As a console user, I want each backend workflow I trigger to be associated with a correlation identifier from the start, so that I can later reference the exact operation if I need help or need to confirm what happened.

**Why this priority**: If the workflow cannot be identified from its first step, the rest of the trace is hard to trust. This is the foundation for all later audit and troubleshooting behavior.

**Independent Test**: Trigger any supported console backend workflow and verify that the execution receives a single correlation identifier that can be used to locate the workflow’s audit trail.

**Acceptance Scenarios**:

1. **Given** a tenant owner triggers a backend workflow, **When** the workflow begins, **Then** the execution is associated with a correlation identifier that can be used to find the resulting audit trail.
2. **Given** the incoming request already includes a correlation identifier, **When** the workflow starts, **Then** the workflow preserves that identifier for the full execution instead of creating a new one.

---

### User Story 2 — Significant workflow milestones are recorded in audit (Priority: P1)

As a security or support operator, I want backend workflows to leave audit records for the important milestones of the execution, so that I can understand what action was attempted, by whom, in which tenant, and what outcome it produced.

**Why this priority**: Audit without consistent milestone coverage is not reliable enough for operational or compliance use. The workflow must be observable at the points that matter.

**Independent Test**: Trigger a backend workflow and verify that the audit trail includes a start record and a terminal record that clearly describe the action, actor, scope, and outcome.

**Acceptance Scenarios**:

1. **Given** a workspace admin triggers a workflow, **When** execution starts, **Then** an audit record is created that captures the actor, tenant or workspace scope, the workflow name, and the correlation identifier.
2. **Given** the same workflow completes successfully, **When** it reaches its terminal state, **Then** a final audit record is created that captures the completion outcome and the same correlation identifier.
3. **Given** the workflow fails, **When** the failure is detected, **Then** a terminal audit record is created that captures the failure outcome and enough context to identify the affected request.

---

### User Story 3 — Downstream events remain linked to the same workflow trace (Priority: P2)

As an auditor, I want all events generated by one backend workflow execution to remain tied to the same correlation identifier, so that I can reconstruct the workflow as one coherent chain rather than a pile of unrelated records.

**Why this priority**: The value of correlation comes from continuity. If downstream activity loses the trace, the audit trail becomes fragmented and much less useful.

**Independent Test**: Trigger a workflow that performs more than one significant step and verify that every related audit record and downstream event can be grouped under the same correlation identifier.

**Acceptance Scenarios**:

1. **Given** a backend workflow performs multiple steps, **When** those steps generate audit or traceable operational events, **Then** every event is associated with the same correlation identifier.
2. **Given** a workflow retries a step internally, **When** the retry occurs, **Then** the retry remains part of the same workflow trace and does not introduce a new correlation identifier.
3. **Given** a workflow spans more than one internal action, **When** an operator inspects the resulting records, **Then** the operator can see that the records belong to one request lifecycle.

---

### User Story 4 — Authorized users can retrieve the workflow lifecycle from the correlation identifier (Priority: P2)

As a tenant or workspace operator, I want to look up the workflow lifecycle by correlation identifier, so that I can confirm whether the workflow succeeded, failed, or is still in progress.

**Why this priority**: A traceable identifier is only useful if operators can use it to recover the workflow story later. This is the operational payoff of the audit trail.

**Independent Test**: Use a valid correlation identifier from a real workflow and verify that an authorized user can retrieve the matching lifecycle information and terminal outcome.

**Acceptance Scenarios**:

1. **Given** an authorized operator has a correlation identifier from a console workflow, **When** they query the audit trail, **Then** they can retrieve the lifecycle of that workflow without seeing unrelated tenant data.
2. **Given** the workflow is still running, **When** the operator looks up the correlation identifier, **Then** the audit trail shows the workflow as in progress rather than inventing a terminal state.

### Edge Cases

- A caller starts a workflow without providing any correlation identifier. The system must create one so the trace is still recoverable.
- A caller provides a malformed or unusable correlation identifier. The system must avoid recording an ambiguous trace and must still preserve a valid identifier for the execution.
- A workflow emits more than one internal step in quick succession. The audit trail must still group them under one identifier.
- A workflow is retried after a transient failure. The retry must remain attached to the original execution trace so operators do not mistake it for a different request.
- A workflow handles sensitive material during execution. Audit records must describe the action and outcome without exposing the sensitive payload itself.
- A workflow spans a long-running asynchronous period. The correlation identifier must remain stable for the full duration so later investigation can tie early and late events together.

## 4. Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every console backend workflow execution MUST be associated with exactly one correlation identifier that can be used to trace the execution from start to finish.
- **FR-002**: If a workflow request arrives without a correlation identifier, the system MUST assign a new one before the workflow proceeds.
- **FR-003**: If a workflow request arrives with a valid correlation identifier, the system MUST preserve that identifier for the full workflow execution.
- **FR-004**: The system MUST create an audit record when a backend workflow begins, including the actor, tenant scope, workflow name, and correlation identifier.
- **FR-005**: The system MUST create an audit record when a backend workflow reaches a terminal state, including the final outcome and the same correlation identifier.
- **FR-006**: Every significant downstream event or internal step initiated by the workflow MUST remain linked to the same correlation identifier so that the workflow can be reconstructed as one trace.
- **FR-007**: Workflow retries and repeated attempts within the same user-initiated execution MUST preserve the original correlation identifier.
- **FR-008**: Authorized operators MUST be able to recover the lifecycle of a workflow by searching for its correlation identifier, and the retrieved trace MUST remain limited to the correct tenant and workspace scope.
- **FR-009**: Audit records for backend workflows MUST identify the actor and the affected tenant or workspace context clearly enough for a human reviewer to understand who initiated the action and where it applied.
- **FR-010**: Audit records for backend workflows MUST avoid exposing secrets, tokens, or other sensitive payloads while still providing enough detail to describe the action and its outcome.
- **FR-011**: A workflow that is still running MUST remain traceable through the same correlation identifier until it reaches a terminal state.

### Key Entities *(include if feature involves data)*

- **Correlation Identifier**: The stable reference that ties together all audit records and traceable events produced by one backend workflow execution.
- **Audit Record**: A structured record that captures who initiated an action, what was attempted, the affected scope, and the outcome.
- **Workflow Execution**: One instance of a console backend operation from initiation through its terminal state.
- **Actor Context**: The identity and access scope of the user or operator who initiated the workflow.
- **Tenant/Workspace Scope**: The logical boundary that determines which records belong to which customer context.

## 5. Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of console backend workflow executions have a valid correlation identifier from start to finish.
- **SC-002**: 100% of workflow executions produce at least one start audit record and one terminal audit record.
- **SC-003**: In a review sample of 20 completed workflow executions, 100% of the related records can be grouped into a single trace using the same correlation identifier.
- **SC-004**: Authorized operators can locate the full workflow lifecycle for a known correlation identifier in under 1 minute in at least 95% of routine investigation attempts.
- **SC-005**: 0 audit records for these workflows expose sensitive payloads, secrets, or tokens while still leaving enough context to identify the action and outcome.
- **SC-006**: 100% of recovered traces remain limited to the correct tenant and workspace scope.

## 6. Assumptions

- The platform already has a canonical audit sink and a standard way to represent correlation identifiers across related events.
- The console backend workflow functions specified in US-UIB-01-T02 already exist or will exist as the execution surface that this task must make traceable.
- Endpoint separation from US-UIB-01-T03 and saga/compensation behavior from US-UIB-01-T04 are handled independently; this task only ensures traceability and audit participation.
- Authorized operators already have or will have a standard audit lookup surface for reviewing workflow traces; this task does not add a new UI or reporting product.
- The platform’s existing multi-tenant rules apply to audit access as they do to the underlying workflows.
