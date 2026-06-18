# audit — spec delta for add-audit-write-and-scope-enforcement-store

## ADDED Requirements

### Requirement: Audit logging not deployed / scope-enforcement audit broken

The system SHALL ensure that audit logging not deployed / scope-enforcement audit broken is corrected: Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An action appears in audit-records with its correlation id
