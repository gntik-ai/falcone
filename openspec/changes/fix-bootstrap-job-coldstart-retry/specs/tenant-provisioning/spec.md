# tenant-provisioning — spec delta for fix-bootstrap-job-coldstart-retry

## ADDED Requirements

### Requirement: Keycloak bootstrap Job fails on a cold fresh install

The system SHALL ensure that keycloak bootstrap Job fails on a cold fresh install is corrected: Raise `backoffLimit`/retry budget and/or add a Keycloak-readiness wait init-container to the bootstrap Job (chart).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Bootstrap completes on a cold `helm install` without manual re-run
