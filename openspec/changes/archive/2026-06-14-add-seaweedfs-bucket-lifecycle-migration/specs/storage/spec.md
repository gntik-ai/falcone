## ADDED Requirements

### Requirement: Canonical tenant-to-bucket mapping via workspace_buckets

The system SHALL treat the `workspace_buckets` Postgres table as the single authoritative source of truth for the tenant-to-bucket mapping, using a bucket-per-workspace model where each bucket name is a DNS-sanitized string matching `[a-z0-9-]` between 3 and 63 characters, so that bucket identity is stable and unambiguous across all storage operations.

#### Scenario: Bucket name resolves to the owning workspace

- **WHEN** a storage operation is issued for a workspace
- **THEN** the system resolves the target bucket name exclusively from the `workspace_buckets` row for that workspace and does not derive names from tenant-id prefixes or per-tenant prefix strategies

#### Scenario: Legacy prefix strategies do not create new buckets

- **WHEN** the system creates a new workspace
- **THEN** no bucket is created using the `<tenantId>-` name-prefix strategy or the prefix-per-tenant strategy; all bucket creation flows through `workspace_buckets`

### Requirement: Bucket name DNS-sanitization contract

The system SHALL reject any bucket name that does not conform to the pattern `[a-z0-9-]` with a minimum length of 3 and a maximum length of 63 characters before issuing any bucket create or lookup call to the storage backend.

#### Scenario: Valid bucket name is accepted

- **WHEN** a workspace produces a bucket name that matches `[a-z0-9-]` and is between 3 and 63 characters
- **THEN** the system proceeds with the bucket create or lookup without modification

#### Scenario: Invalid bucket name is rejected before backend call

- **WHEN** a workspace produces a bucket name that contains uppercase letters, underscores, or exceeds 63 characters
- **THEN** the system rejects the name with a validation error and does not issue any call to the storage backend

### Requirement: Bucket recreation idempotency on migration

The system SHALL ensure that running the bucket reconciliation step multiple times against the same storage backend produces the same result as running it once, so that re-runs on failure or re-execution after partial completion do not create duplicate buckets or overwrite existing configuration.

#### Scenario: Bucket already exists on re-run

- **WHEN** the reconciliation step is run and a bucket matching the `workspace_buckets` entry already exists on the storage backend
- **THEN** the system leaves the existing bucket unchanged and does not issue a second create call

#### Scenario: Missing bucket is created on re-run

- **WHEN** the reconciliation step is run and a bucket for a `workspace_buckets` entry does not yet exist on the storage backend
- **THEN** the system creates the bucket and records the outcome, regardless of whether prior runs completed partially

### Requirement: Lifecycle and config recreation with explicit gap handling

The system SHALL recreate lifecycle rules, bucket policies, CORS configuration, and versioning settings on SeaweedFS for each workspace bucket where the backend's compatibility matrix confirms support, and SHALL record an explicit structured gap entry with a `decision` field for each PARTIAL or UNSUPPORTED setting so that no declared configuration is silently lost.

#### Scenario: Supported lifecycle rule is recreated on SeaweedFS

- **WHEN** a workspace bucket has a declared lifecycle rule and the adr-spike compatibility matrix lists lifecycle rules as SUPPORTED for the deployed SeaweedFS version
- **THEN** the system applies the lifecycle rule to the SeaweedFS bucket using `putBucketLifecycleConfiguration` and records a `decision: "applied"` entry

#### Scenario: Unsupported config is logged and skipped, not silently dropped

- **WHEN** a workspace bucket has a declared CORS configuration and the adr-spike compatibility matrix lists CORS as UNSUPPORTED for the deployed SeaweedFS version
- **THEN** the system does not issue a `putBucketCors` call, records a structured gap entry with `decision: "drop"` and the SeaweedFS version, and returns without error

#### Scenario: Partial support applies the supported subset and logs omitted fields

- **WHEN** a workspace bucket has a lifecycle rule whose filter predicate is listed as PARTIAL in the compatibility matrix
- **THEN** the system applies the supported subset of the rule, records a structured gap entry naming each omitted field, and does not silently discard the omitted fields without logging

### Requirement: Dry-run mode lists planned bucket and lifecycle actions

The system SHALL provide a dry-run mode for the bucket reconciliation step that collects and outputs all planned bucket-create and config-apply actions as a structured list without executing any write against the storage backend, so that operators can review the migration plan before applying.

#### Scenario: Dry-run outputs all planned creates without writing

- **WHEN** the reconciliation step is invoked with the dry-run flag
- **THEN** the system outputs a structured list of every bucket to be created and every config action to be applied, and no bucket or config write is issued to the storage backend

#### Scenario: Dry-run surfaces name-collision conflicts

- **WHEN** two workspaces produce the same DNS-sanitized bucket name and the reconciliation step is invoked with the dry-run flag
- **THEN** the system includes a conflict entry in the dry-run output identifying both workspaces and halts planning for those two buckets without issuing any write

### Requirement: Post-migration per-tenant bucket isolation

The system SHALL enforce that after bucket reconciliation, no bucket on the storage backend is reachable by a credential belonging to a different tenant, so that per-tenant storage isolation is preserved across the migration.

#### Scenario: Cross-tenant bucket access is denied after reconciliation

- **WHEN** the reconciliation step has completed for Tenant A's workspace bucket
- **THEN** an attempt to access that bucket using a storage credential scoped to Tenant B returns a 403 Forbidden response from the storage backend

#### Scenario: Intra-tenant workspace access is permitted after reconciliation

- **WHEN** the reconciliation step has completed for a workspace bucket owned by Tenant A
- **THEN** a storage credential scoped to Tenant A can successfully perform a head-bucket check against that bucket
