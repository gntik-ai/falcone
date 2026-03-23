# Feature Specification: BaaS Internal Service Map and Contract Baseline

**Feature Branch**: `feature/us-arc-01`  
**Created**: 2026-03-23  
**Status**: Draft  
**Input**: User description: "Define the internal service map of the BaaS: control API, provisioning orchestrator, adapters to platform services, and audit module. Keep scope incremental and focused on what/why."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Platform engineers share one control-plane boundary map (Priority: P1)

As platform engineers, we need one explicit internal service map for the BaaS so that later implementation tasks can add behavior inside stable boundaries instead of coupling the control API directly to providers.

**Why this priority**: The control plane will coordinate identity, data, messaging, functions, and storage concerns. Without a service map first, later tasks would invent boundaries ad hoc and create circular dependencies.

**Independent Test**: The story is complete when a reviewer can inspect one repository-native package and identify the control API, provisioning orchestrator, audit module, required adapter ports, and allowed dependency directions.

**Acceptance Scenarios**:

1. **Given** a future task that adds a provisioning workflow, **When** the contributor reviews the service map, **Then** they can see which module accepts the command, which module sequences provider work, and which modules must remain decoupled.
2. **Given** a repository validation run, **When** the service-map validator executes, **Then** it confirms that the required services, adapter ports, and dependency rules remain present and internally consistent.

---

### User Story 2 - Internal contracts stay auditable before runtime code exists (Priority: P2)

As architecture and security stakeholders, we need explicit internal contract shapes for control commands, orchestration requests/results, provider adapter calls/results, and audit records so that future runtime work inherits stable expectations for versioning, idempotency, and error classification.

**Why this priority**: Downstream tasks will implement real handlers, queues, persistence, and provider clients. Contract ambiguity now would force repeated rework across control-plane, provisioning, and audit surfaces.

**Independent Test**: The story is complete when repository tests can assert that the internal contract catalog contains the required envelopes, required fields, and append-only/idempotent semantics where applicable.

**Acceptance Scenarios**:

1. **Given** a non-read control-plane operation, **When** a contributor inspects the contract catalog, **Then** they can find the required idempotency key, contract version, actor context, and error classification expectations.
2. **Given** a provider integration task for Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, or storage, **When** the contributor inspects the adapter catalog, **Then** they can find the adapter port, expected capabilities, and shared call/result envelope.

---

### User Story 3 - Future modules gain scaffolding without committing to frameworks too early (Priority: P3)

As the delivery team, we need minimal package scaffolding for provisioning, audit, internal contracts, control-plane boundary access, and adapter catalog access so that later tasks can extend the same structure without replacing bootstrap artifacts.

**Why this priority**: This story should unblock later implementation without prematurely selecting queues, ORMs, SDKs, or execution frameworks reserved for sibling tasks T02-T06.

**Independent Test**: The story is complete when the repository contains extendable package/module entry points that expose the service map and contract slices without implementing provider runtime behavior.

**Acceptance Scenarios**:

1. **Given** a future provisioning implementation task, **When** it starts in the monorepo, **Then** a dedicated `services/provisioning-orchestrator` workspace already exists and points to the internal contract boundary it must respect.
2. **Given** a future audit implementation task, **When** it starts in the monorepo, **Then** a dedicated `services/audit` workspace already exists and records the append-only audit contract boundary.

### Edge Cases

- The control API starts calling provider adapters directly, bypassing the provisioning orchestrator.
- The audit module is treated as an incidental logger instead of an append-only evidence boundary.
- Different adapters invent incompatible retry/error payloads.
- A future task adds a new internal command without a contract version or idempotency expectation.
- Provisioning retries create duplicate provider resources because the request envelope does not carry a stable idempotency key.
- Provider-specific details leak into shared control-plane modules and make Keycloak/PostgreSQL/MongoDB/Kafka/OpenWhisk/storage work diverge unnecessarily.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST define a machine-readable internal service map for the control plane that includes `control_api`, `provisioning_orchestrator`, and `audit_module`.
- **FR-002**: The service map MUST define adapter ports for `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, and `storage`.
- **FR-003**: The service map MUST record allowed dependency directions so that provider integrations remain isolated behind adapter ports and circular service dependencies are rejected.
- **FR-004**: The repository MUST define an internal contract catalog for at least `control_api_command`, `provisioning_request`, `provisioning_result`, `adapter_call`, `adapter_result`, and `audit_record`.
- **FR-005**: The internal contract catalog MUST record versioning expectations and required fields for each contract.
- **FR-006**: Non-read control and provisioning contracts MUST record idempotency expectations and error classifications.
- **FR-007**: The audit contract MUST be defined as append-only evidence and MUST capture actor, scope, action, outcome, correlation, and timestamp metadata.
- **FR-008**: The repository MUST provide minimal package scaffolding for `services/internal-contracts`, `services/provisioning-orchestrator`, and `services/audit`, plus control-plane and adapter entry points that consume the shared contract catalog.
- **FR-009**: Root validation commands MUST verify the service-map package and its scaffolding automatically.
- **FR-010**: Scope MUST remain limited to `US-ARC-01-T01` and MUST NOT introduce production runtime frameworks, live provider SDK integration, background workers, message brokers, database schema implementation, or deployment changes reserved for sibling tasks T02-T06.

### Key Entities *(include if feature involves data)*

- **Service Boundary**: A named internal module with explicit responsibilities, owned resources, inbound contracts, and allowed dependencies.
- **Adapter Port**: A provider-facing integration boundary that standardizes capabilities and call/result envelopes while hiding provider-specific code.
- **Internal Contract**: A versioned envelope used between modules to carry commands, results, errors, and audit evidence.
- **Provisioning Run**: The logical orchestration unit keyed by a stable idempotency key and correlation metadata.
- **Audit Record**: The append-only evidence envelope emitted for control-plane and provisioning actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The repository contains a spec/plan/supporting-doc package for `US-ARC-01-T01` plus a task breakdown note tracing the work from intent to implementation.
- **SC-002**: Root validation confirms the internal service map, contract catalog, and scaffolding are present and internally consistent.
- **SC-003**: Repository tests assert the required service boundaries, adapter ports, contract envelopes, and key invariants for dependency direction, versioning, idempotency, and append-only audit behavior.
- **SC-004**: The monorepo contains lightweight scaffolding for control-plane, internal-contracts, provisioning-orchestrator, audit, and adapters that later tasks can extend without replacing the current package structure.
- **SC-005**: The change preserves room for later tasks to add runtime behavior, persistence, queues, and provider implementations without re-opening the baseline boundary map.
