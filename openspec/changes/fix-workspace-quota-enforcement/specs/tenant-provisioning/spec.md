# tenant-provisioning — spec delta for fix-workspace-quota-enforcement

## ADDED Requirements

### Requirement: Per-project (workspace) quota not enforced

The system SHALL ensure that per-project (workspace) quota not enforced is corrected: Gate workspace creation on the tenant's resolved workspace-count entitlement; 4xx on breach.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Creating past the limit → 402/409 quota error
