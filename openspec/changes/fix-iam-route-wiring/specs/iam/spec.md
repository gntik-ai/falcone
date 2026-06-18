# iam — spec delta for fix-iam-route-wiring

## ADDED Requirements

### Requirement: Wire the catalogued IAM routes (getIamUser / role-by-name / realm CRUD)

The system SHALL ensure that wire the catalogued IAM routes (getIamUser / role-by-name / realm CRUD): Register the handlers (or remove them from the catalog).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Catalogued IAM routes resolve to their handlers
