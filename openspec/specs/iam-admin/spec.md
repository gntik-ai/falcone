# iam-admin Specification

## Purpose
TBD - created by archiving change bind-iam-realm-to-caller-tenant. Update Purpose after archive.
## Requirements
### Requirement: IAM admin requests are bound to the caller's tenant realm

The system SHALL assert that `context.realmId` equals the authenticated caller's `tenantId` for every non-platform-scoped IAM admin request, leveraging the established convention that `realm = tenantId` (`services/provisioning-orchestrator/src/collectors/iam-collector.mjs:70`). The assertion MUST occur inside `validateIamAdminRequest` (`services/adapters/src/keycloak-admin.mjs:285-323`) after `tenantId` is passed in from `buildIamAdminAdapterCall` (`services/adapters/src/keycloak-admin.mjs:489`). When the assertion fails, the system MUST return HTTP 403 before constructing or issuing any Keycloak admin call.

#### Scenario: Tenant-scoped caller cannot operate on another tenant's realm

- **WHEN** a caller whose verified tenant is `A` issues an IAM admin request (e.g. `DELETE /v1/iam/realms/{realmId_of_B}/users/{userId}`) targeting a `realmId` that equals tenant `B`'s ID
- **THEN** the system returns HTTP 403 before any Keycloak admin call is constructed or sent
- **AND** tenant `B`'s Keycloak realm is unmodified

#### Scenario: Same-tenant IAM admin request is permitted

- **WHEN** a caller whose verified tenant is `A` issues an IAM admin request targeting a `realmId` that equals tenant `A`'s ID
- **THEN** the system passes validation and proceeds to construct and issue the Keycloak admin call

### Requirement: Platform-scoped callers retain unrestricted realm access

The system SHALL exempt callers whose `context.scope` is `'platform'` from the `context.realmId === tenantId` assertion, allowing platform-scoped operators to administer any tenant's Keycloak realm.

#### Scenario: Platform-scoped caller operates on any tenant's realm

- **WHEN** a caller holding a platform-scoped role issues an IAM admin request targeting a `realmId` belonging to any tenant
- **THEN** the system does not apply the `realmId === tenantId` check
- **AND** the Keycloak admin call is constructed and issued normally

### Requirement: tenantId is propagated into realm validation without exception

The system SHALL ensure that `tenantId` is passed from `buildIamAdminAdapterCall` into `validateIamAdminRequest` for every IAM admin request, so that no code path in the route family can reach Keycloak adapter logic without having been subject to the realm-binding assertion.

#### Scenario: Missing tenantId propagation is eliminated

- **WHEN** any IAM admin route in the `/v1/iam/realms/{realmId}/…` family is invoked
- **THEN** `buildIamAdminAdapterCall` passes `tenantId` to `validateIamAdminRequest` before any adapter call is made
- **AND** `validateIamAdminRequest` performs the `realmId === tenantId` check for non-platform scope

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

