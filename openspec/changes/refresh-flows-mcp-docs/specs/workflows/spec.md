## ADDED Requirements

### Requirement: The workflow DSL is documented with a complete reference
The system SHALL publish a workflow DSL reference that documents the full flow document shape and provides a valid YAML example for every node type, task type, and trigger, matching the implemented JSON Schema, and SHALL cross-link it from the Flows guide.

#### Scenario: The DSL reference covers every node and task type
- **WHEN** the documentation site is built
- **THEN** a DSL reference page presents valid YAML for each node type, task type, and trigger, and is linked from the Flows guide

#### Scenario: Examples match the implemented schema
- **WHEN** a reader copies a YAML example from the DSL reference
- **THEN** the example conforms to the flow-definition schema (no invented syntax)

### Requirement: Flows documentation reflects its delivered status
The system SHALL present Flows as a delivered Preview capability in the README and docs, rather than as in-progress or planned, while preserving the platform's not-production-ready posture.

#### Scenario: Flows is labelled Preview
- **WHEN** a reader views the README or the Flows guide
- **THEN** Flows is presented as Preview, not as "in active development" or "planned"
