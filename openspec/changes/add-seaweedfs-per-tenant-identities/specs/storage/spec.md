# storage — spec delta for add-seaweedfs-per-tenant-identities

## ADDED Requirements

### Requirement: SeaweedFS bootstrap S3 identity is bucket-scoped, not a cross-tenant skeleton key

The deployment SHALL load a SeaweedFS S3 identities document in which the shared bootstrap/admin identity (`falcone-s3-admin`) is granted ONLY per-bucket-scoped actions (`Action:bucket`) over a reserved platform-bucket prefix, and SHALL NOT grant it any global/wildcard action. The system SHALL therefore ensure that the holder of the shared S3 credential cannot list, read, or write any tenant bucket directly over the S3 gateway.

This corrects the live 2026-06-18 breach (evidence `audit/live-campaign/evidence/22-storage-s3.md`): the chart previously issued one identity carrying a global `["Admin","Read","Write","List","Tagging"]` grant, so whoever held the `in-falcone-storage` keys could list/read/write ALL tenants' buckets.

#### Scenario: Bootstrap identities document grants no global action

- **WHEN** the SeaweedFS identities config the deployment loads is built (chart Secret `seaweedfs_s3_config`, or `buildSeaweedFSIdentitiesConfig`)
- **THEN** every `actions` entry on every identity is a per-bucket-scoped string of the form `Action:bucket` (no bare global action is present)
- **AND** the admin identity's bucket scope is confined to the reserved platform-bucket prefix

#### Scenario: Shared admin credential is denied on a tenant bucket

- **WHEN** an S3 request is signed with the shared bootstrap admin credential and targets a tenant's namespaced bucket
- **THEN** the request is denied (the admin identity carries no action scoped to that tenant bucket)

### Requirement: Tenant object-storage buckets are namespaced by tenant and workspace

The system SHALL derive each workspace's S3 bucket name with a deterministic tenant/workspace namespace (`t-<tenantHash>-<workspaceHash>`) that is DNS-safe and unique per (tenant, workspace), so two distinct tenants or workspaces can never collapse to the same S3 bucket name and tenant attribution is visible at the S3 layer.

#### Scenario: Distinct tenants never collide on a bucket name

- **WHEN** bucket names are derived for two different (tenant, workspace) pairs, even with identical slug hints
- **THEN** the derived names are DNS-safe (`[a-z0-9-]{3,63}`), deterministic, and never equal
- **AND** each name carries the tenant namespace prefix (no longer a raw resourceId)

### Requirement: A workspace storage credential is scoped to its own bucket and denied cross-tenant

The system SHALL scope each per-workspace SeaweedFS identity to that workspace's own namespaced bucket only, fail-closed on an absent or wildcard bucket scope, so a workspace credential can only access its own buckets and a cross-tenant S3 probe is denied.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** a workspace credential for tenant A is used against tenant B's bucket over the S3 gateway
- **THEN** the request is denied (AccessDenied / 403) and a workspace credential can only access its own buckets

#### Scenario: An unscoped or wildcard workspace identity is rejected before write

- **WHEN** an identities document is built for a workspace with an empty or wildcard (`*`) bucket scope
- **THEN** the build is rejected with `INVALID_IDENTITY_SCOPE` and no identity is written
