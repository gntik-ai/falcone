# secrets — spec delta for add-vault-secret-consumption

## ADDED Requirements

### Requirement: Vault is deployable on kind but no component consumes it (secrets-as-a-service unwired)

The system SHALL ensure that vault is deployable on kind but no component consumes it (secrets-as-a-service unwired): Wire a secrets backend (ESO/agent injection or a Vault client in the control-plane) so per-tenant/per-env secrets resolve from Vault; enable Vault in the kind profile via the non-cert-manager tls.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A secret set via the API is stored in Vault and made available (isolated per env) to a function/service
