# data-api — spec delta for fix-ddl-column-contract-and-pk

## ADDED Requirements

### Requirement: Postgres DDL column contract + primary key

The Postgres DDL executor SHALL accept the documented public create-table body — the table
name supplied as `name` (in addition to `tableName`) and each column as `{ name, type }` (in
addition to `{ columnName, dataType }`) — and SHALL honour a `primaryKey: true` flag declared
either at the top level of a column or under a nested `constraints` object. A column flagged as
the primary key SHALL be emitted NOT NULL with an actual `PRIMARY KEY` constraint so the table
is immediately usable by the data API (which requires a declared primary key).

#### Scenario: documented body shape creates the table

- **WHEN** a create-table request uses `{ name, columns: [{ name, type }] }`
- **THEN** the table is created and no `Invalid tableName identifier` / `DDL_INVALID` rejection is returned

#### Scenario: primaryKey:true emits a usable PRIMARY KEY

- **WHEN** a column declares `primaryKey: true` (top-level or nested under `constraints`)
- **THEN** the emitted CREATE TABLE carries an inline `PRIMARY KEY` for that column
- **AND** the column is created NOT NULL
- **AND** the resulting table reports a primary key index, so the data API accepts by-primary-key reads/writes
