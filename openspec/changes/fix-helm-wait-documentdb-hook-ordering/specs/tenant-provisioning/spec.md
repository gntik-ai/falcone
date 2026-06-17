# tenant-provisioning — spec delta for fix-helm-wait-documentdb-hook-ordering

## MODIFIED Requirements

### Requirement: helm install --wait converges without deadlock

The system SHALL ensure that `helm install --wait` on a fresh cluster converges to
the Ready state within the standard Helm timeout, with no circular dependency between
main resources and post-install hooks.

#### Scenario: helm install --wait completes on a fresh kind cluster

- **WHEN** `helm install --wait` is executed on a fresh kind cluster
- **THEN** all main resources (including FerretDB) MUST reach Ready state and the
  install MUST complete without a `Progress deadline exceeded` timeout
