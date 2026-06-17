# tenant-provisioning — spec delta for fix-ferretdb-init-documentdb-host

## MODIFIED Requirements

### Requirement: FerretDB init container resolves the DocumentDB host dynamically

The system SHALL derive the DocumentDB service host for the FerretDB init container
from the Helm release name rather than a hardcoded string, so that an install with
any release name converges to the Ready state.

#### Scenario: Fresh install with non-default release name reaches Ready

- **WHEN** the Helm chart is installed with a release name other than `in-falcone`
  (e.g. `falcone`, `my-baas`)
- **THEN** the FerretDB pod's init container MUST connect to the DocumentDB service
  at the correct release-prefixed hostname and MUST transition to `Running` within
  the standard timeout

#### Scenario: Fresh install with default release name is unaffected

- **WHEN** the Helm chart is installed with the default release name `in-falcone`
- **THEN** the FerretDB pod MUST continue to reach Ready state as before
