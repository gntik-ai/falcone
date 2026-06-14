## ADDED Requirements

### Requirement: Storage capability has authoritative architecture documentation

The system SHALL maintain an authoritative architecture and operations runbook for its active object-store backend (currently SeaweedFS) such that any operator can determine the component topology, per-tenant identity model, replication policy, and day-2 operations procedures without reading source code or Helm charts.

#### Scenario: Architecture documentation covers the active object-store backend

- **WHEN** an operator needs to understand the storage backend topology
- **THEN** a documentation file exists in the repository that authoritatively describes the active backend's components, replication, credential model, and operations

#### Scenario: No documentation file misidentifies the active object-store backend

- **WHEN** any repository documentation file references an object-store product by name
- **THEN** it names the currently active backend (SeaweedFS) and does not present a superseded backend (MinIO) as the active store
