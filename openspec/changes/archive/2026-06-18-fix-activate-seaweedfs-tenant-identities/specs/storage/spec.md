# storage — spec delta for fix-activate-seaweedfs-tenant-identities

## ADDED Requirements

### Requirement: Per-tenant SeaweedFS identity issuance is on by default

Per-workspace SeaweedFS identity issuance on bucket provision SHALL be enabled by
default and SHALL NOT depend on an environment flag that a Helm values overlay can
silently drop by replacing the control-plane env list. Issuance MAY be disabled only
by an explicit opt-out (`STORAGE_TENANT_IDENTITIES` set to `0`/`false`/`off`/`no`).

#### Scenario: identities are issued even when the env flag is absent

- **WHEN** the control-plane runs with no `STORAGE_TENANT_IDENTITIES` env (e.g. an
  overlay replaced the env list)
- **THEN** per-workspace identity issuance is still active, so each provisioned bucket
  vends a distinct, bucket-scoped S3 credential instead of `storageCredential: null`.

#### Scenario: issuance can still be turned off explicitly

- **WHEN** `STORAGE_TENANT_IDENTITIES` is set to `0` (or `false`/`off`/`no`)
- **THEN** identity issuance is skipped (for backends without filer-mode support).
