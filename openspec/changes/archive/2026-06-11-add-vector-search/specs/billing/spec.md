## ADDED Requirements

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
