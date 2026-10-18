## ADDED Requirements

### Requirement: Named tenant-scoped embedding connections

The system SHALL support at most 32 connections per tenant/workspace through
`/v1/workspaces/{workspaceId}/embedding-providers[/{connectionId}]`. GET lists
items by connectionId. POST returns 201, GET/PUT/DELETE return 200, and unknown
items return 404 `EMBEDDING_CONNECTION_NOT_FOUND`. Invalid POST identifiers return
400 `INVALID_CONNECTION_ID`; duplicates and overflow return 409
`EMBEDDING_CONNECTION_EXISTS` and `EMBEDDING_CONNECTION_LIMIT_REACHED` respectively.
Responses include configuration, identity, default state and timestamps.

#### Scenario: Connections coexist without crossing tenant boundaries

- **WHEN** two connections are created in one tenant/workspace
- **THEN** both appear in its sorted list and neither appears for another tenant
- **AND** rejected identifiers, duplicates and overflow leave existing rows intact

### Requirement: Defaults and singular compatibility

The first connection SHALL become default. POST or PUT with `isDefault: true`
SHALL move the default atomically. Clearing the current default through PUT SHALL
return 409 `EMBEDDING_DEFAULT_REQUIRED`. Deleting it SHALL promote nothing.
Replacing PUTs SHALL retain the re-index warning. Singular PUT/GET/DELETE SHALL
operate on the default, preserving the prior response shape plus connectionId.

#### Scenario: Singular PUT at capacity without a default

- **GIVEN** 32 non-default connections and no connection named `default`
- **WHEN** singular PUT would insert a default
- **THEN** it returns 409 `EMBEDDING_CONNECTION_LIMIT_REACHED` and changes nothing

### Requirement: Safe configuration and authorization

All writes SHALL run the existing secret-reference and endpoint guards before
storage and SHALL never persist plaintext keys. Tenant identity SHALL come only
from the verified caller. Write routes SHALL be catalogued as `structural_admin`.

#### Scenario: Structural writes reject unauthorized identities

- **WHEN** a viewer, roleless caller, API key or differently bound workspace admin writes
- **THEN** the request returns 403 with no change
- **AND** a workspace admin bound to the target workspace can write

#### Scenario: Unsafe configuration is rejected before storage

- **WHEN** a write contains a disallowed secretRef or blocked endpoint
- **THEN** it returns 400 and stores no configuration

### Requirement: Mapping-specific embedding and deletion protection

Mapping PUT/GET SHALL carry optional connectionId. Named mapping writes SHALL
validate the tenant/workspace connection and return 422
`EMBEDDING_CONNECTION_NOT_FOUND` if absent. Auto-embedding and KNN queryText SHALL
use the mapping's connection; omitted selectors SHALL use the default. A missing
named connection SHALL return 422 before provider calls. Without a default,
unselected embedding SHALL return 422 `EMBEDDING_PROVIDER_MISSING`.

#### Scenario: Mapping selection remains consistent for writes and searches

- **GIVEN** a mapped vector column naming a non-default connection
- **WHEN** a text row is written or queryText searches that column
- **THEN** embedding uses that connection's endpoint

#### Scenario: An explicit mapping protects a connection

- **WHEN** plural, singular or legacy DELETE targets a named in-use connection
- **THEN** it fails with `EMBEDDING_CONNECTION_IN_USE` and changes nothing
- **AND** HTTP deletion returns 409

### Requirement: Idempotent legacy migration and tenant purge

Schema setup SHALL copy unmarked legacy rows once under the advisory and table
locks, preserving every embedding field and both legacy timestamps. Old-executor
upsert and DELETE SHALL operate on the default through a retained mirror trigger.
Tenant purge SHALL include every registry connection.

#### Scenario: Concurrent or repeated setup cannot resurrect a connection

- **WHEN** setup runs concurrently or reruns after a migrated connection is deleted
- **THEN** each legacy row is copied at most once and the deleted connection stays absent

#### Scenario: Purge removes only the selected tenant

- **GIVEN** both tenants have default and non-default connections
- **WHEN** one tenant is purged
- **THEN** all its connections disappear and the other tenant's remain
