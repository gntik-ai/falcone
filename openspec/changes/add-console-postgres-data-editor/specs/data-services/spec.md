# Data Services — Console Postgres Data Editor

## ADDED Requirements

### Requirement: DDL operations are executed from the console (not preview-only)

The system SHALL allow a console user to submit CREATE TABLE, ADD COLUMN, and CREATE
INDEX operations through `ConsolePostgresPage` with `executionMode: "execute"` so that
schema changes take effect immediately and the tree reflects the new state without
requiring an external tool.

#### Scenario: Create a table from the UI and see it in the browser

- **WHEN** a console user fills in the create-table form within `ConsolePostgresPage`,
  selects a database and schema, and confirms the operation
- **THEN** the console calls the DDL execute endpoint with `executionMode: "execute"`,
  the new table appears in the tables list upon reload, and a success confirmation is
  displayed without any stack trace in the UI

#### Scenario: Backend DDL error is surfaced clearly

- **WHEN** the DDL execute endpoint returns a 4xx or 5xx response
- **THEN** the console displays the backend-supplied `message` field as an inline error
  banner and does not show a stack trace or raw JSON body

### Requirement: Row-level data editing is available from a data grid in the console

The system SHALL provide a data grid tab inside the selected-table view of
`ConsolePostgresPage` that allows a console user to insert, update, and delete rows
via the Postgres data-CRUD API, with support for filtering and pagination, so that
data can be managed without a separate database client.

#### Scenario: Insert a row from the data grid

- **WHEN** a console user opens the data tab for a selected table, fills in the new-row
  form, and submits it
- **THEN** the console calls the row-insert endpoint (`POST …/rows`), and the newly
  inserted row appears in the grid on the next load

#### Scenario: Edit an existing row from the data grid

- **WHEN** a console user selects a row in the data grid, modifies one or more field
  values, and confirms the update
- **THEN** the console calls the row-update endpoint (`PATCH …/rows/{rowId}`) and the
  grid reflects the updated values after reload

#### Scenario: Delete a row from the data grid

- **WHEN** a console user selects a row in the data grid and chooses the delete action
- **THEN** the console calls the row-delete endpoint (`DELETE …/rows/{rowId}`) and the
  deleted row is absent from the grid on the next load

#### Scenario: Backend row mutation error is surfaced clearly

- **WHEN** a row insert, update, or delete call returns an error response
- **THEN** the console displays the `message` field from the error response as an inline
  error banner scoped to the data grid, without a stack trace

### Requirement: An API-keys panel allows minting, rotating, and revoking anon and service keys

The system SHALL provide an API-keys panel within the Postgres console page that calls
the app-api-keys API family so that developers can obtain and manage the Supabase-
compatible anon and service keys needed to access their Postgres database from a
client application.

#### Scenario: Mint an anon key and display it once with a frontend snippet

- **WHEN** a console user opens the API-keys panel for a selected database and mints a
  new anon key
- **THEN** the console calls the key-create endpoint, displays the raw anon key value
  exactly once in a masked copy-field (the value is not retrievable from the panel
  again), and immediately renders a copy-paste JavaScript snippet containing the
  PostgREST endpoint URL and the anon key so the user can integrate it into a client app

#### Scenario: Rotate an existing key

- **WHEN** a console user selects an existing key in the API-keys panel and triggers
  rotation
- **THEN** the console calls the key-rotate endpoint and the panel reflects the updated
  key metadata (creation timestamp, key type); the new key value is shown once

#### Scenario: Revoke a key

- **WHEN** a console user selects a key in the API-keys panel and confirms revocation
- **THEN** the console calls the key-delete endpoint and the key is removed from the
  panel listing

#### Scenario: Backend key-management error is surfaced clearly

- **WHEN** a key mint, rotate, or revoke call returns an error response
- **THEN** the console displays the `message` field as an inline error banner within
  the API-keys panel, without a stack trace or raw credential value

### Requirement: Typed service modules wrap the three API families for console use

The system SHALL provide typed TypeScript service modules
(`postgresDataApi.ts`, `postgresDdlApi.ts`, `postgresKeysApi.ts`) under
`apps/web-console/src/services/` that delegate to `requestConsoleSessionJson` so that
`ConsolePostgresPage` and the API-keys panel have a stable, testable interface to the
backend families independent of URL construction details.

#### Scenario: Service module is the sole HTTP caller for its API family

- **WHEN** `ConsolePostgresPage` or a sub-component needs to call the DDL execute,
  row CRUD, or app-api-keys backend endpoints
- **THEN** all HTTP calls go through the corresponding service module
  (`postgresDdlApi.ts`, `postgresDataApi.ts`, or `postgresKeysApi.ts`) rather than
  calling `requestConsoleSessionJson` inline, so that URL construction and
  response-type assertions are centralised and testable in isolation
