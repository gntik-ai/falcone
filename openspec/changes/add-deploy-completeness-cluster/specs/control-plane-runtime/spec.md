# control-plane-runtime — spec delta for add-deploy-completeness-cluster

## ADDED Requirements

### Requirement: No workspace teardown API; Vault unwired; narrow Prometheus scrape

The system SHALL ensure that no workspace teardown API; Vault unwired; narrow Prometheus scrape is corrected: Add a workspace GET/DELETE API with cascading cleanup; either wire Vault (ESO/agent + cert-manager) or document it out-of-scope on kind; widen the Prometheus scrape config.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A workspace can be deleted via API with full cleanup
