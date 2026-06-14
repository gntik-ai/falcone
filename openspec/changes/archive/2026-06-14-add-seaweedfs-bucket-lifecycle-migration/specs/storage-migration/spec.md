## ADDED Requirements

### Requirement: Bucket reconciliation from workspace_buckets source of truth

The system SHALL provide a bucket reconciliation command that reads all rows from the `workspace_buckets` table, merges in any buckets discovered on the source MinIO backend that have no corresponding row, and ensures each bucket exists on the target SeaweedFS backend with the same name and workspace association.

#### Scenario: All workspace_buckets rows are reconciled to SeaweedFS

- **WHEN** the bucket reconciliation command is run against a SeaweedFS backend that has no buckets
- **THEN** every bucket named in `workspace_buckets` is created on SeaweedFS and the command reports each created bucket

#### Scenario: Discovered MinIO bucket with no workspace_buckets row is reconciled

- **WHEN** a bucket exists on the source MinIO backend but has no corresponding row in `workspace_buckets`
- **THEN** the reconciliation command inserts a `workspace_buckets` row for that bucket, creates it on SeaweedFS, and reports it as a discovered-and-reconciled entry

#### Scenario: workspace_buckets rows remain valid after reconciliation

- **WHEN** the reconciliation command completes successfully
- **THEN** every row in `workspace_buckets` references a bucket that exists on SeaweedFS under the same name, so no application-layer change is required

### Requirement: Name-collision detection halts affected buckets

The system SHALL detect when two or more workspaces produce the same DNS-sanitized bucket name during reconciliation and SHALL halt reconciliation for those conflicting buckets, reporting a named conflict, without blocking reconciliation of non-conflicting buckets.

#### Scenario: Collision is reported and affected buckets are skipped

- **WHEN** two workspaces produce the same sanitized bucket name
- **THEN** the reconciliation command reports a conflict entry identifying both workspaces and their bucket name, skips creating either bucket on SeaweedFS, and continues reconciling all remaining non-conflicting buckets

#### Scenario: Non-conflicting buckets proceed despite a collision elsewhere

- **WHEN** a name collision exists between two workspaces and other workspaces have unique bucket names
- **THEN** the unique buckets are created on SeaweedFS and only the colliding pair is skipped

### Requirement: Gap log records all config decisions for auditability

The system SHALL produce a structured gap log entry for every lifecycle, policy, CORS, and versioning setting evaluated during reconciliation, recording the bucket name, config type, SeaweedFS version, and the outcome (`applied`, `partial`, or `drop`) so that the migration result is fully auditable without inspecting the storage backend.

#### Scenario: Gap log entry is written for every evaluated config type

- **WHEN** the reconciliation command processes a workspace bucket with declared lifecycle, policy, CORS, and versioning settings
- **THEN** the gap log contains one entry per config type, each with `bucketName`, `configType`, `seaweedfsVersion`, and `decision`

#### Scenario: Gap log is machine-readable

- **WHEN** the reconciliation command completes
- **THEN** the gap log is output as newline-delimited JSON so that operators can process it with standard tooling

### Requirement: Reconciliation prerequisite check

The system SHALL verify that the SeaweedFS backend is reachable and that the `add-seaweedfs-storage-provider` client is configured before executing any reconciliation action, and SHALL halt with a descriptive error if either precondition is not met.

#### Scenario: Reconciliation halts if SeaweedFS is unreachable

- **WHEN** the reconciliation command is invoked and the SeaweedFS endpoint does not respond to a connectivity probe
- **THEN** the command exits with a non-zero status and an error message identifying the unreachable endpoint, without creating any bucket or writing any config

#### Scenario: Reconciliation halts if storage provider client is unconfigured

- **WHEN** the reconciliation command is invoked and the storage provider credentials or endpoint are missing from configuration
- **THEN** the command exits with a non-zero status and an error message identifying the missing configuration, without creating any bucket or writing any config
