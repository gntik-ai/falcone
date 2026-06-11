# billing Specification

## Purpose
TBD - created by archiving change add-usage-billing-export. Update Purpose after archive.
## Requirements
### Requirement: Per-cycle usage records are projected from consumption snapshots

The system SHALL, on each `quota_metering` calculation cycle, project per-tenant consumption snapshots into immutable usage records containing at minimum `cycleId`, `tenant_id`, dimension values, and `snapshotTimestamp`, and persist them as the authoritative source of truth for billing.

#### Scenario: Completed metering cycle produces a usage record per in-scope tenant

- **WHEN** a `quota_metering` calculation cycle completes with a non-empty `processedScopes` list
- **THEN** the system MUST create exactly one usage record per tenant in `processedScopes`, each record containing the `cycleId`, `tenant_id`, all resolved dimension values, and the `snapshotTimestamp` from the cycle audit

#### Scenario: Usage record contains all consumption dimensions from the tenant snapshot

- **WHEN** a usage record is created for a tenant in a given cycle
- **THEN** the record MUST include every dimension key present in the output of `tenant-consumption-snapshot-get` for that tenant, with no dimension omitted or defaulted to zero without a corresponding `usageUnknownReason`

### Requirement: Usage records are idempotent on (cycleId, tenant_id)

The system SHALL ensure that re-running or replaying a `quota_metering` cycle for the same `cycleId` and `tenant_id` does not produce duplicate usage records; the operation MUST be idempotent.

#### Scenario: Replaying a cycle for an already-processed tenant is a no-op

- **WHEN** the billing emitter receives a cycle event for a `(cycleId, tenant_id)` pair that already has a stored usage record
- **THEN** the system MUST NOT create a new record, MUST NOT modify the existing record, and MUST return a success response indicating deduplication occurred

#### Scenario: Distinct cycle IDs for the same tenant each produce a separate record

- **WHEN** two different `cycleId` values are processed for the same `tenant_id`
- **THEN** the system MUST produce two distinct, independent usage records — one per `cycleId` — with no data from one cycle contaminating the other

### Requirement: Usage records are published to the console.billing.usage topic

The system SHALL publish each newly created usage record to the `console.billing.usage` Kafka topic with a structured envelope containing tenant scope, `cycleId`, dimension values, and `snapshotTimestamp`, immediately after the record is persisted.

#### Scenario: New usage record triggers a console.billing.usage event

- **WHEN** a usage record is successfully persisted for a `(cycleId, tenant_id)` pair
- **THEN** the system MUST publish a message to `console.billing.usage` whose payload includes `cycleId`, `tenant_id`, the full dimension map, and `snapshotTimestamp`, and whose envelope conforms to the tenant-scoped audit envelope schema

#### Scenario: Deduplicated (already-existing) record does not re-publish to the topic

- **WHEN** the billing emitter detects that a `(cycleId, tenant_id)` record already exists and skips creation
- **THEN** the system MUST NOT publish a duplicate message to `console.billing.usage`

### Requirement: A billing_boundary_change audit event is emitted for each usage record creation

The system SHALL emit a `billing_boundary_change` audit event (the reserved optional category in the `quota_metering` subsystem) for each successful usage-record creation, with scope attribution referencing the `tenant_id` and `cycleId`.

#### Scenario: Successful usage record creation produces a billing audit event

- **WHEN** a usage record is created for `(cycleId, tenant_id)` for the first time
- **THEN** the system MUST emit an audit event with `action_category = billing_boundary_change`, `subsystem_id = quota_metering`, `tenant_id` set to the record's tenant, and `detail.cycleId` matching the record's cycle

#### Scenario: No audit event is emitted for a deduplicated cycle replay

- **WHEN** the billing emitter skips creation because the `(cycleId, tenant_id)` record already exists
- **THEN** the system MUST NOT emit a `billing_boundary_change` audit event for that replay

### Requirement: Platform admins can query usage records via GET /v1/platform/billing/usage

The system SHALL expose `GET /v1/platform/billing/usage` and `GET /v1/platform/billing/usage/{tenantId}` routes that return paginated usage records, accessible only to actors with platform-admin scope.

#### Scenario: Platform admin retrieves all usage records with pagination

- **WHEN** a platform-admin actor sends `GET /v1/platform/billing/usage` with valid credentials
- **THEN** the system MUST respond with HTTP 200 and a paginated list of usage records, each containing `cycleId`, `tenant_id`, dimensions, and `snapshotTimestamp`

#### Scenario: Non-admin caller is rejected with HTTP 403

- **WHEN** a caller without platform-admin scope sends `GET /v1/platform/billing/usage`
- **THEN** the system MUST respond with HTTP 403 and MUST NOT return any usage record data

#### Scenario: Tenant-scoped query returns only that tenant's records

- **WHEN** a platform-admin actor sends `GET /v1/platform/billing/usage/{tenantId}` for a specific tenant
- **THEN** the system MUST return only usage records whose `tenant_id` matches the path parameter, with no records from other tenants included in the response

### Requirement: Vector quota dimensions are tracked per tenant in the metering subsystem

The system SHALL add three new quota dimensions to the metering subsystem:
`vector_row_count` (total number of rows containing non-null vector values across all
collections in the tenant's dedicated database), `max_vector_dimension` (maximum
allowed integer dimension for any vector column in the workspace), and
`vector_index_memory_mb` (estimated memory footprint of all HNSW/IVFFlat indexes for
that workspace, used for noisy-neighbor control). These dimensions SHALL appear in the
tenant consumption snapshot and in the billing usage record produced by the existing
billing cycle, consistent with the schema of usage records described in the billing spec.

#### Scenario: Usage record includes vector quota dimensions

- **WHEN** a billing metering cycle completes for a tenant that has at least one
  collection with a vector column
- **THEN** the usage record for that tenant includes non-null values for
  `vector_row_count`, `max_vector_dimension`, and `vector_index_memory_mb` alongside
  the existing dimension fields

#### Scenario: Tenant with no vector columns has zero vector quota values

- **WHEN** a billing metering cycle completes for a tenant that has no vector columns
  in any collection
- **THEN** the usage record for that tenant includes `vector_row_count: 0`,
  `max_vector_dimension: 0`, and `vector_index_memory_mb: 0`

### Requirement: Vector insert and index creation are blocked when quota limits are exceeded

The system SHALL enforce per-tenant quota limits on vector usage: an insert into a
collection with a vector column SHALL fail with HTTP 429 when `vector_row_count` has
reached the plan limit, and a DDL request to add a vector column with a `dimension`
exceeding `max_vector_dimension` SHALL fail with HTTP 422 before any SQL is executed.

#### Scenario: Insert is rejected when vector_row_count quota is exceeded

- **WHEN** a tenant's `vector_row_count` reaches the workspace plan limit and a
  data-access caller attempts to insert a new row into a collection with a vector column
- **THEN** the system rejects the insert with HTTP 429 and an error body identifying
  `vector_row_count` as the exceeded quota dimension; no row is written

#### Scenario: Column creation is rejected when dimension exceeds max_vector_dimension

- **WHEN** a structural admin submits a DDL request to add a vector column with
  `dimension` greater than the workspace's `max_vector_dimension` plan limit
- **THEN** the system rejects the request with HTTP 422 before executing any SQL,
  citing `max_vector_dimension` as the exceeded quota dimension

