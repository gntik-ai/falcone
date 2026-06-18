# quotas-plans — spec delta for fix-plan-impact-usage-bigint

## ADDED Requirements

### Requirement: Plan-impact usage column overflows INTEGER (no tenant can be assigned a plan)

The system SHALL ensure that plan-impact usage column overflows INTEGER (no tenant can be assigned a plan): Change `observed_usage` (and sibling usage columns) to BIGINT.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Plan assign -> 2xx
