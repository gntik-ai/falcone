# data-residency Specification

## Purpose
TBD - created by archiving change add-data-residency-pinning. Update Purpose after archive.
## Requirements
### Requirement: Per-tenant data residency region selection

The system SHALL allow a `dataResidency.region` attribute to be specified when
provisioning a tenant, validated against the platform's declared supported regions,
so that the tenant's data jurisdiction is an explicit, auditable configuration
value rather than an implicit platform default.

#### Scenario: Tenant provisioned with a valid residency region

- **WHEN** a platform admin creates a tenant with `dataResidency.region: "eu-west-1"`
  and that region is present in the platform's supported-regions catalog
- **THEN** the tenant record persists `dataResidency.region: "eu-west-1"` and a
  subsequent GET for that tenant returns the same value

#### Scenario: Tenant provisioned with an unsupported region is rejected

- **WHEN** a platform admin attempts to create a tenant with
  `dataResidency.region: "ap-southeast-99"` and that region is not in the supported-
  regions catalog
- **THEN** the request is rejected with a 400-class error identifying the invalid
  region and no tenant record is created

#### Scenario: Region selection is isolated per tenant

- **WHEN** Tenant A is provisioned with `dataResidency.region: "eu-west-1"` and
  Tenant B is provisioned with `dataResidency.region: "us-east-1"`
- **THEN** Tenant A's region is "eu-west-1" and Tenant B's region is "us-east-1"
  with neither record reflecting the other's value

### Requirement: Provisioning appliers respect the tenant's pinned region

The system SHALL thread the resolved `regionRef` through every provisioning applier
(IAM, Kafka, Postgres, MongoDB, storage, functions) so all resources for a tenant
are placed in the tenant's pinned region and not in the platform's default region.

#### Scenario: All appliers target the pinned region during tenant provisioning

- **WHEN** a tenant with `dataResidency.region: "eu-west-1"` is provisioned
- **THEN** the IAM realm, Kafka topics, Postgres schema, MongoDB namespace, storage
  namespace, and function namespace are all created in the cluster or endpoint
  associated with "eu-west-1"

#### Scenario: Applier refuses to target a region not in the supported catalog

- **WHEN** an applier receives a `regionRef` that is not present in the platform's
  supported-regions catalog
- **THEN** the applier returns an error and no resource is created in any region

### Requirement: Cross-region requests are rejected and audited

The system SHALL detect when a data-plane request targets or would retrieve data
from a region other than the tenant's pinned region, reject the request, and emit a
`residency_violation` audit event, so that boundary-crossing attempts are visible
in the per-tenant audit trail.

#### Scenario: Request respecting the pinned region succeeds

- **WHEN** a request from Tenant A (pinned to "eu-west-1") targets a resource in
  "eu-west-1"
- **THEN** the request proceeds normally and no `residency_violation` event is emitted

#### Scenario: Cross-region request is rejected with a residency-violation event

- **WHEN** a request that would place or retrieve Tenant A's data in a region other
  than "eu-west-1" reaches the control plane
- **THEN** the request is rejected with a 403-class response indicating a residency
  boundary violation, and a `residency_violation` audit event is emitted with
  `tenantId`, `pinnedRegion: "eu-west-1"`, and `requestedRegion`

### Requirement: Region availability is discoverable

The system SHALL expose the set of available regions through a platform topology
endpoint so that tenant admins and integrations can enumerate valid region values
before provisioning.

#### Scenario: Platform topology endpoint lists supported regions

- **WHEN** a platform admin queries `GET /v1/platform/topology/regions`
- **THEN** the response includes a list of region identifiers that are valid values
  for `dataResidency.region` at provisioning time

#### Scenario: Regions list reflects the deployment-topology configuration

- **WHEN** the platform's `deployment-topology.json` lists "eu-west-1" as the only
  supported region
- **THEN** `GET /v1/platform/topology/regions` returns exactly ["eu-west-1"] and no
  other region identifiers

