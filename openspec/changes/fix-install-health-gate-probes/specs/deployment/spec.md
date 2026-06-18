# deployment — spec delta for fix-install-health-gate-probes

## ADDED Requirements

### Requirement: Install health-gate probes report false negatives

The system SHALL ensure that install health-gate probes report false negatives: Probe paths/clients that reflect real health (e.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The health gate passes when the platform is actually healthy
