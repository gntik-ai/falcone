# tenant-provisioning — spec delta for fix-vault-secrets-backend-on-kind

## ADDED Requirements

### Requirement: Vault secrets backend installs cleanly on kind without cert-manager

The chart SHALL provide a kind-compatible Vault TLS path selected by `vault.tls.mode`:
`cert-manager` (default) renders the cert-manager Certificate; `self-signed` instead
renders a pre-install hook Job that generates the server TLS Secret with openssl, so that
enabling Vault on a cluster without cert-manager does not abort the release.

#### Scenario: vault.enabled=true installs without cert-manager on kind

- **WHEN** the chart is installed with `vault.enabled=true` and `vault.tls.mode=self-signed`
  on a kind cluster that does not have cert-manager
- **THEN** the render MUST contain no `cert-manager.io/v1` resource and MUST contain a
  pre-install hook Job that provisions the `vault-server-tls` Secret, so the release installs
  cleanly without errors related to missing CRDs or certificates

## ADDED Requirements

### Requirement: At least one app secret resolves from Vault when Vault is enabled

The system SHALL wire at least one application secret through Vault (via ESO or
equivalent) so that enabling Vault provides a real end-to-end secrets resolution path.

#### Scenario: App secret resolves from Vault

- **WHEN** Vault is enabled and a configured secret is stored in Vault
- **THEN** the consuming application MUST receive the secret value from Vault and
  MUST NOT fall back to a plain Kubernetes Secret for that value
