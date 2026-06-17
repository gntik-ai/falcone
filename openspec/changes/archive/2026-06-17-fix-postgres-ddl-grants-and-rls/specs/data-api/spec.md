## ADDED Requirements

### Requirement: DDL-created tables MUST be immediately usable via the data API

The system SHALL, when a table is created through the DDL API, grant the api-key data roles (`falcone_service`/`falcone_anon`) the privileges required by the data API and install the tenant RLS policy on that table, so the data API does not return `TABLE_NOT_FOUND` for a table it just created.

#### Scenario: Create-table then CRUD round-trip succeeds for the issuing tenant

- **WHEN** a tenant creates a table via the DDL API and then inserts a row via its service key
- **THEN** the insert succeeds and the table is readable/writable by the issuing tenant (no `TABLE_NOT_FOUND`)

#### Scenario: A newly created table is scoped to the issuing tenant

- **WHEN** a tenant creates a table and another tenant attempts to read it
- **THEN** the other tenant cannot access the table's rows
