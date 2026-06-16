## ADDED Requirements

### Requirement: Object storage runs on SeaweedFS by default; the MinIO product is removed

The system SHALL default object storage to SeaweedFS and SHALL remove the MinIO **product**: the
`storage` (MinIO) subchart/alias, the `minio/minio` image, the `MINIO_*` config/console env, and the
airgap/kind MinIO image overlays. The default storage provider type SHALL be `seaweedfs` (not
`minio`). Generic S3 terminology, the S3 client, and the `STORAGE_S3_*` configuration SHALL be
retained.

#### Scenario: Default provider is SeaweedFS and no MinIO product artifact remains

- **WHEN** the storage layer resolves its default provider with no explicit override
- **THEN** the provider type is `seaweedfs`, the chart deploys SeaweedFS only, and no residual
  reference describes a deployed MinIO product
