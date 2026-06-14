## ADDED Requirements

### Requirement: SeaweedFS is the default-active object-store backend

The system SHALL deploy SeaweedFS as the default-active S3-compatible object store in the umbrella Helm chart and in the local development/test stack, and SHALL NOT deploy MinIO by default. MinIO SHALL remain available as an explicit, opt-in rollback toggle (re-enabled by setting `storage.enabled: true`) so the retention-window rollback path defined by the rollback runbook stays usable.

#### Scenario: Chart default enables SeaweedFS and disables MinIO

- **WHEN** the umbrella chart is rendered with default values (no profile or override)
- **THEN** the SeaweedFS components (master, volume, filer, S3 gateway) are enabled (`seaweedfs.enabled: true`) and the MinIO `storage` component is not deployed (`storage.enabled: false`)

#### Scenario: HA profile uses SeaweedFS as the object store

- **WHEN** the umbrella chart is rendered with the HA profile
- **THEN** SeaweedFS is the deployed object store in its HA topology (multi-master / multi-volume) and MinIO is not deployed

#### Scenario: MinIO remains an explicit rollback toggle

- **WHEN** an operator sets `storage.enabled: true` during the rollback retention window
- **THEN** the MinIO component is deployed again without requiring any chart change, and no SeaweedFS object data is destroyed (PVCs are retained)

#### Scenario: Local dev/test stack runs SeaweedFS as its S3 backend

- **WHEN** the `tests/env` stack is brought up
- **THEN** the S3-compatible backend is SeaweedFS (S3 gateway reachable at the harness `S3_ENDPOINT`, host port `:58333`), the `falcone-test` bucket is bootstrapped against it, and the real-stack suites resolve storage through the provider-agnostic `S3_*` environment with no MinIO container running
