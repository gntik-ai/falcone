# audit — spec delta for fix-audit-enforcement-logging

## ADDED Requirements

### Requirement: Enforcement audit logs never written (quota + scope denials)

The system SHALL ensure that enforcement audit logs never written (quota + scope denials): Write an audit record at each enforcement point with the correlation id.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A 402/403 produces a correlated audit row
