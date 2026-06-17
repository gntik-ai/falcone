# tenant-provisioning — spec delta for fix-vault-secrets-backend-on-kind

## MODIFIED Requirements

### Requirement: Vault secrets backend installs cleanly on kind without cert-manager

The system SHALL provide a kind-compatible Vault installation path that does not
require cert-manager, so that enabling Vault does not abort the release.

#### Scenario: vault.enabled=true installs without cert-manager on kind

- **WHEN** the chart is installed with `vault.enabled=true` on a kind cluster that
  does not have cert-manager
- **THEN** the release MUST install cleanly without errors related to missing CRDs
  or certificates

## ADDED Requirements

### Requirement: At least one app secret resolves from Vault when Vault is enabled

The system SHALL wire at least one application secret through Vault (via ESO or
equivalent) so that enabling Vault provides a real end-to-end secrets resolution path.

#### Scenario: App secret resolves from Vault

- **WHEN** Vault is enabled and a configured secret is stored in Vault
- **THEN** the consuming application MUST receive the secret value from Vault and
  MUST NOT fall back to a plain Kubernetes Secret for that value
