# data-api — spec delta for fix-ddl-column-contract-and-pk

## ADDED Requirements

### Requirement: Postgres DDL column contract + primary key

The system SHALL ensure that postgres DDL column contract + primary key: Accept the documented `name/type` shape (or fix the OpenAPI), and emit a PRIMARY KEY constraint when `primaryKey:true`.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The documented create-table body works and `primaryKey` creates a usable PK
