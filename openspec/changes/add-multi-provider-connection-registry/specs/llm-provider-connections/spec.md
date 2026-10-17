## ADDED Requirements

### Requirement: Named LLM connections coexist within a workspace

The system SHALL persist up to 32 connections keyed by tenant, workspace and
connection identifier, matching `^[a-z0-9][a-z0-9-]{0,62}$`. It SHALL expose
collection GET/POST and item GET/PUT/DELETE under `/llm-providers`.

#### Scenario: Two providers coexist

- **WHEN** an authorized caller creates `openai-main` and `anthropic-main`
- **THEN** both persist and collection GET returns both ordered by connectionId
- **AND** each response includes connection metadata and only its secret reference

#### Scenario: Invalid, duplicate, missing and excess connections

- **WHEN** POST uses an invalid identifier, duplicate identifier or a 33rd connection
- **THEN** it returns respectively 400 `INVALID_CONNECTION_ID`, 409
  `LLM_CONNECTION_EXISTS` or 409 `LLM_CONNECTION_LIMIT_REACHED`, without changes
- **AND** unknown item GET, PUT and DELETE return 404 `LLM_CONNECTION_NOT_FOUND`
- **AND** displayName accepts at most 128 characters

### Requirement: Defaults change atomically

The first connection SHALL become default. POST or PUT with `isDefault:true`
SHALL clear the previous default atomically. PUT with `isDefault:false` on the
current default SHALL return 409 `LLM_DEFAULT_REQUIRED`. Deleting the default
SHALL leave none, without automatic promotion.

#### Scenario: Default moves and is removed

- **WHEN** PUT or POST selects another default
- **THEN** exactly one connection is default
- **WHEN** that connection is deleted
- **THEN** the remaining connections have no default

### Requirement: Connection writes preserve identity and BYOK boundaries

Writes SHALL use verified tenant identity, the existing structural role gate and
workspace scope check. Bound workspace owner/admin and broad write-capable admins
SHALL succeed. Other-workspace owner/admin, developer, viewer, no-role and API-key
callers SHALL receive 403. Config writes SHALL validate secret references and
endpoints before storage; plaintext key fields SHALL never be persisted.

#### Scenario: Rejected configuration writes no row

- **WHEN** a request supplies an off-allow-list secretRef or blocked endpoint
- **THEN** it returns 400 and changes no connection

#### Scenario: Tenant isolation

- **WHEN** two tenants use the same workspaceId and connectionId
- **THEN** each reads and mutates only its own connections
- **AND** a tenantId in the request body cannot override the verified tenant

### Requirement: Legacy APIs and completions use the registry default

Singular PUT SHALL update the default, promote an existing `default` if needed,
or insert it subject to the capacity limit. Singular GET SHALL retain the legacy
shape plus connectionId, returning 404 `LLM_PROVIDER_NOT_FOUND` when absent.
Singular DELETE SHALL remove only the default and return `{ removed }`.

#### Scenario: Completion without a selected connection

- **WHEN** a completion omits connection selection
- **THEN** it uses the registry default
- **AND** with no default it returns 422 `LLM_PROVIDER_MISSING`
- **AND** an empty registry result never causes a legacy-table read

#### Scenario: Worker before and after migration

- **WHEN** a worker reads provider configuration
- **THEN** it executes no DDL and reads the registry default
- **AND** only SQLSTATE 42P01 allows fallback to the legacy read
- **AND** permission and connection errors propagate

### Requirement: Migration and legacy writes preserve connections

Schema setup SHALL take the specified advisory and legacy table locks in one
transaction, copy unmigrated rows to `default` with every field intact and both
timestamps from legacy updated_at, mark migrated rows and install the legacy
mirror trigger. It SHALL retain the legacy table and unique constraint.

#### Scenario: Idempotent migration

- **WHEN** setup runs repeatedly or concurrently
- **THEN** each legacy row is copied once
- **AND** deleting a migrated connection does not cause its recreation

#### Scenario: Old executors write during the rollout

- **WHEN** an old executor inserts or updates legacy config
- **THEN** the current default is updated, or existing `default` is promoted,
  or `default` is inserted if absent
- **AND** only an insert creating a 33rd connection fails, changing nothing
- **AND** a migrated_at-only update mirrors nothing
- **WHEN** an old executor deletes the legacy provider
- **THEN** only the registry default is removed
