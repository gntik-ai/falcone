# tenant-lifecycle — spec delta for fix-control-plane-schema-migration-retry

## ADDED Requirements

### Requirement: Control-plane schema migrations retry on transient DB unavailability

The system SHALL retry the boot schema migration with exponential backoff when the
initial connection attempt fails with `ECONNREFUSED` or equivalent transient errors,
continuing until the migration succeeds or a configured maximum retry duration
(default 5 minutes) is exceeded.

#### Scenario: Control-plane started before Postgres converges to schema-ready

- **WHEN** the control-plane starts and PostgreSQL is not yet accepting connections
- **THEN** the control-plane MUST retry the migration at increasing intervals, log
  each attempt, and eventually succeed once Postgres becomes available — without
  requiring a pod restart

#### Scenario: Max retry duration exceeded — control-plane exits with error

- **WHEN** PostgreSQL is unavailable for longer than the configured maximum retry
  duration
- **THEN** the control-plane MUST exit with a non-zero code and a clear error log
  indicating the migration timed out, so that Kubernetes restarts the pod

#### Scenario: Successful migration after retry — tenant ops succeed

- **WHEN** the migration succeeds after one or more retries
- **THEN** subsequent calls to `POST /v1/tenants` MUST return 201 and the `tenants`
  table MUST be present in the database
