# control-plane-runtime — spec delta for fix-governance-schema-bootstrap

## ADDED Requirements

### Requirement: Governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500)

The system SHALL ensure that governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500) is corrected: Ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the bootstrap Job runs the governance migrations) so all provisioning-orchestrator actions resolve.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The four endpoints return 200
