# tenant-provisioning — spec delta for fix-stale-migration-components-in-running-release

## MODIFIED Requirements

### Requirement: Deployed release contains no legacy migration-era components

The system SHALL ensure that a deployment from current chart source contains no
MongoDB, MinIO (legacy), or OpenWhisk workloads, and that the control-plane and
executor environment variables reference FerretDB and SeaweedFS respectively.

#### Scenario: No legacy workloads present after deploy from current chart

- **WHEN** the chart is deployed from current source HEAD
- **THEN** `kubectl get all` in the release namespace MUST contain no resources with
  names matching `mongodb`, `minio` (legacy storage), or `openwhisk`

#### Scenario: CI guard fails if legacy components render in chart output

- **WHEN** the chart template is rendered in CI
- **THEN** any resource referencing `mongodb`, `minio`, or `openwhisk` MUST cause
  the CI step to exit non-zero
