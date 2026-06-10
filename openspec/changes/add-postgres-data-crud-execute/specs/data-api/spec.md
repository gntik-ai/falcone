# Data API

## ADDED Requirements

### Requirement: Row CRUD plans are executed against the workspace database

The system SHALL execute the SQL plan produced by `buildPostgresDataApiPlan` against
the workspace Postgres database, acquiring the connection under the caller's effective
RLS role so that `list`, `get`, `insert`, `update`, and `delete` requests return real
data or effect real mutations.

#### Scenario: Insert then list returns the inserted row

- **WHEN** a caller with `data_access` privilege inserts a row into a workspace table
  via `POST /v1/collections/{name}/documents` and then lists rows via
  `GET /v1/collections/{name}/documents`
- **THEN** the list response contains the row that was inserted and the insert response
  returns the full row with all `RETURNING` columns populated

#### Scenario: Filter and keyset pagination return the correct subset

- **WHEN** a caller requests rows with an `eq` filter on a column and a `page[size]`
  limit via `POST /v1/collections/{name}/query`
- **THEN** the response contains only rows matching the filter, the number of rows does
  not exceed `page[size]`, and a `page.after` cursor is present when more rows exist

### Requirement: Executor enforces the caller's RLS context

The system SHALL acquire the workspace database connection under the caller's effective
RLS role and emit the plan's session settings before executing any SQL, so that
row-level security policies filter results and guard writes without server-side
predicate injection by the BaaS layer.

#### Scenario: Anon-key caller sees only RLS-permitted rows

- **WHEN** a caller authenticated with an anon key issues a `list` request on a table
  that has an RLS policy permitting only rows where `owner_id = auth.uid()`
- **THEN** the response contains only rows whose `owner_id` matches the caller's
  identity and no rows belonging to other identities are included, even if they exist
  in the table

#### Scenario: WITH CHECK blocks a cross-tenant insert

- **WHEN** a caller authenticated as tenant A attempts to insert a row that would fail
  the table's `WITH CHECK` RLS policy (e.g. `tenant_id` does not match the session
  claim)
- **THEN** the insert is rejected with a 403-class response and no row is written to
  the database

### Requirement: Bulk operations execute atomically

The system SHALL execute `bulk_insert`, `bulk_update`, and `bulk_delete` plans as a
single database transaction so that either all rows in the batch are affected or none
are, and partial-batch failures do not leave the table in an inconsistent state.

#### Scenario: Bulk insert persists all rows or none

- **WHEN** a caller submits a bulk insert of N rows and the operation succeeds
- **THEN** all N rows are present in the table and the response lists all N inserted
  row identifiers

### Requirement: RPC calls return the routine result

The system SHALL execute an `rpc` plan against the workspace database and return the
result set produced by the target Postgres function so that callers can invoke
workspace-defined routines through the data API.

#### Scenario: RPC call returns the function result

- **WHEN** a caller invokes a workspace routine via the `rpc` operation with a valid
  argument set
- **THEN** the response contains the value returned by the Postgres function and the
  HTTP status is 200

### Requirement: Driver errors are mapped to sanitized HTTP responses

The system SHALL translate Postgres driver error codes to deterministic HTTP status
codes and return an opaque error reference without exposing internal SQL details, so
that callers receive actionable errors and no schema or query information is leaked.

#### Scenario: Constraint violation returns 409

- **WHEN** an insert or update violates a unique or foreign-key constraint on the
  workspace table
- **THEN** the response status is 409 and the body contains a structured error with
  `code: "CONFLICT"` and an opaque `reference` identifier but no SQL fragment

#### Scenario: Invalid input returns 400

- **WHEN** a caller supplies a value that cannot be cast to the target column type
  and the plan produces a Postgres invalid-input error
- **THEN** the response status is 400 and the body identifies the offending field
  without exposing the internal SQL text
