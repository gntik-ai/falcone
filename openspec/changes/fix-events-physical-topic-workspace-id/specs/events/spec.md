# events — spec delta for fix-events-physical-topic-workspace-id

## ADDED Requirements

### Requirement: Events: derive the physical Kafka topic from the workspace id, not the slug

The system SHALL ensure that events: derive the physical Kafka topic from the workspace id, not the slug: Derive the control-plane physical name from the unique workspace id (align with `events-executor.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds
