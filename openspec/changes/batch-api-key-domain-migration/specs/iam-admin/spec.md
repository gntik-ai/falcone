## ADDED Requirements

### Requirement: API-key domain migration fetches only unclassified rows via a SQL predicate

The system SHALL include `WHERE privilege_domain IS NULL` in the SELECT query issued by the API-key privilege-domain migration, so that already-classified rows are never fetched from the database. The system SHALL NOT issue a bare full-table SELECT and discard classified rows in the application layer.

#### Scenario: Migration skips already-classified rows at the SQL level

- **WHEN** the API-key privilege-domain migration runs and the `api_keys` table contains rows with `privilege_domain IS NOT NULL`
- **THEN** those rows are not included in the SELECT result set returned to the application
- **AND** the migration does not re-classify or re-emit events for those rows

#### Scenario: Migration processes all unclassified rows on first run

- **WHEN** the migration runs against a table where all rows have `privilege_domain IS NULL`
- **THEN** every row is classified and receives a non-null `privilege_domain` value after the migration completes

### Requirement: Migration processes rows in bounded keyset-paginated batches

The system SHALL process unclassified `api_keys` rows in sequential keyset-paginated batches using `WHERE privilege_domain IS NULL AND id > $lastId ORDER BY id ASC LIMIT $batchSize`. The system SHALL bound peak application memory to at most `$batchSize` rows at any time, where `$batchSize` is controlled by the `APIKEY_DOMAIN_MIGRATION_BATCH_SIZE` environment variable with a default of 500.

#### Scenario: Large table is processed in multiple bounded batches

- **WHEN** the `api_keys` table contains more unclassified rows than `$batchSize`
- **THEN** the migration issues multiple SELECT queries, each fetching at most `$batchSize` rows
- **AND** no single query returns more than `$batchSize` rows to application memory

#### Scenario: Batch size is configurable

- **WHEN** `APIKEY_DOMAIN_MIGRATION_BATCH_SIZE` is set to a value N before the migration runs
- **THEN** each paginated batch fetches at most N rows from the database

### Requirement: Migration reduces UPDATE round-trips with a batched multi-row UPDATE per batch

The system SHALL replace per-row UPDATE calls with a single multi-row UPDATE statement per batch. Each batched UPDATE MUST include the `AND privilege_domain IS NULL` idempotency guard so that re-running the migration does not overwrite rows that were classified after the SELECT.

#### Scenario: Batch UPDATE is idempotent on rerun

- **WHEN** the migration is run a second time after a complete first run
- **THEN** the second run issues no UPDATE statements (all rows already have `privilege_domain IS NOT NULL`)
- **AND** no events are re-emitted for already-classified rows

#### Scenario: Event emission is preserved for pending_classification rows

- **WHEN** the migration classifies a row that previously had `privilege_domain = 'pending_classification'`
- **THEN** `buildAssignedEvent` is invoked for that row and the event is published to the appropriate topic
