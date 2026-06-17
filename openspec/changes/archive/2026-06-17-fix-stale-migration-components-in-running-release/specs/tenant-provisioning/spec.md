# tenant-provisioning — spec delta for fix-stale-migration-components-in-running-release

## ADDED Requirements

### Requirement: Deployed release contains no legacy migration-era components

A deployment from current chart source SHALL contain no MongoDB, MinIO (legacy), or
OpenWhisk workloads, container images, or host env values, and the control-plane and
executor SHALL reference FerretDB (documentdb) and SeaweedFS respectively. The chart
SHALL fail closed (render error) if a legacy `mongodb`, `minio`, or `openwhisk` values
stanza is reintroduced.

#### Scenario: No legacy workloads present after deploy from current chart

- **WHEN** the chart is rendered from current source HEAD
- **THEN** no rendered workload/Service/Job MUST be named for `mongodb`, `minio`, or
  `openwhisk`, no container image MUST reference them, and no env value MUST pin a
  legacy host; the data-plane env MUST reference the documentdb (FerretDB) engine and
  SeaweedFS

#### Scenario: Guard fails if a legacy stanza is reintroduced

- **WHEN** the chart is rendered with a `mongodb`, `minio`, or `openwhisk` values stanza set
- **THEN** the render MUST exit non-zero with an error naming the offending legacy component
