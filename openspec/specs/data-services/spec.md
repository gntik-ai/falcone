# data-services Specification

## Purpose
TBD - created by archiving change add-console-postgres-data-editor. Update Purpose after archive.
## Requirements
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

### Requirement: pgvector extension enablement is gated on database_per_tenant placement

The system SHALL enforce that the `vector` extension (already present in
`POSTGRES_EXTENSION_CATALOG` at
`services/adapters/src/postgresql-governance-admin.mjs` lines 36-41 with
`placementModes: ['database_per_tenant']`) can only be enabled for workspaces whose
data plane uses `database_per_tenant` placement, and SHALL propagate the placement
check through the `validatePostgresGovernanceRequest` path so that the existing
`authorizedEntry.placementModes` guard rejects the request before any SQL is sent.

In addition to the API-layer placement gate above, the system SHALL query
`pg_available_extensions` on the target Postgres instance before issuing
`CREATE EXTENSION` for any extension requested via the provisioning path
(`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::_processResource`, case
`'extensions'`). The system SHALL NOT issue `CREATE EXTENSION` when the extension is absent from
`pg_available_extensions`. Instead, the system SHALL emit a configuration validation error result
(action `'error'`) that names the extension. For the `vector` extension specifically, the error
message SHALL instruct the operator to provision a pgvector-capable Postgres image (e.g.
`pgvector/pgvector:pgNN`) for the dedicated-DB tenant instance, because the default
`bitnami/postgresql:17.2.0` image referenced in `charts/in-falcone/values.yaml` does not bundle
the pgvector control files.

The pre-flight check is a `SELECT 1 FROM pg_available_extensions WHERE name = $1` query executed
via the same injected `query` function already used by `_processResource` for existence checks
(`SELECT extname, extversion FROM pg_extension WHERE extname = $1`). This query is cheap (catalog
scan on a small system table), does not mutate state, and resolves early — before any
`_createResource` call — so no partial-apply state can accumulate. The placement gate rejects
requests at the API layer for wrong placement modes; the pre-flight gate rejects requests at the
provisioning layer when the instance's image lacks the extension's control files. The pre-flight is
skipped when the extension is already installed (its presence in `pg_extension` proves the image
ships it), so already-provisioned tenants see no behaviour change.

#### Scenario: Extension enabled for dedicated-DB workspace passes validation

- **WHEN** a governance request to enable the `vector` extension is submitted with a
  profile carrying `placementMode: "database_per_tenant"`
- **THEN** `validatePostgresGovernanceRequest` returns `ok: true` and
  `buildPostgresGovernanceSqlPlan` emits
  `CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public"`

#### Scenario: Extension enablement for schema-per-tenant workspace is rejected by the validator

- **WHEN** a governance request to enable the `vector` extension is submitted with a
  profile carrying `placementMode: "schema_per_tenant"`
- **THEN** `validatePostgresGovernanceRequest` returns `ok: false` with a violation
  message identifying the placement mode incompatibility, and no SQL plan is produced

#### Scenario: Extension not present in pg_available_extensions is rejected without CREATE EXTENSION

- **WHEN** `_processResource` is asked to provision an extension whose name is absent from the
  target instance's `pg_available_extensions` catalog (i.e. `SELECT 1 FROM
  pg_available_extensions WHERE name = $1` returns zero rows)
- **THEN** the provisioning path SHALL return an `action: 'error'` result for that resource,
  SHALL NOT call `_createResource` for that extension, and SHALL NOT issue `CREATE EXTENSION IF
  NOT EXISTS` to the database

#### Scenario: Vector extension unavailability error names the extension and instructs on image

- **WHEN** `_processResource` is asked to provision the `vector` extension and
  `pg_available_extensions` does not contain `vector`
- **THEN** the error message SHALL include the string `vector`, SHALL reference the need for a
  pgvector-capable Postgres image (e.g. `pgvector/pgvector:pgNN`), and SHALL NOT contain a raw
  Postgres error or stack trace

#### Scenario: Available extension is still created normally

- **WHEN** `_processResource` is asked to provision an extension whose name IS present in
  `pg_available_extensions` (i.e. the query returns at least one row) and the extension is not
  yet installed
- **THEN** the provisioning path SHALL proceed to call `_createResource` and issue
  `CREATE EXTENSION IF NOT EXISTS "<name>"` exactly as before, returning `action: 'created'`

#### Scenario: Dry-run reports the would-be configuration error without issuing DDL

- **WHEN** `apply` is invoked with `dryRun: true` and the extension is absent from
  `pg_available_extensions`
- **THEN** the provisioning path SHALL return an `action: 'error'` result naming the extension and
  the image remedy, and SHALL NOT issue `CREATE EXTENSION IF NOT EXISTS` to the database, so that
  operators can detect the configuration problem in a dry-run pass before any DDL is attempted

### Requirement: Chart exposes a documented dedicated-DB tenant Postgres image value replacing the comment-only note

The Helm chart (`charts/in-falcone/values.yaml`) SHALL expose a dedicated, documented key for the
pgvector-capable Postgres image recommended for `database_per_tenant` tenants
(`postgresql.dedicatedTenantImage.repository` and `postgresql.dedicatedTenantImage.tag`) in place of
the current comment-only `NOTE (add-vector-search)`. The new key SHALL carry a meaningful default
(`repository: pgvector/pgvector`, `tag: pg17`) and an inline comment explaining that this value is
an operator contract for dedicated-DB tenant instances and does NOT affect the shared-instance
default (`postgresql.image`). The `postgresql.image` default (`bitnami/postgresql:17.2.0`) SHALL
remain unchanged. The chart's strict `values.schema.json` SHALL accept and enforce the key (it
references the shared `image` definition: a malformed `dedicatedTenantImage` is rejected).

This value is an operator configuration contract, not a runtime-templated image: dedicated DBs in
the `dpf_01regulateddedicated` profile are operator-provisioned instances, not per-tenant
StatefulSets rendered by the chart template. The chart value exists so that operators have a
named, greppable override point and a clear record of the recommended image, not to drive an
automatic image substitution.

#### Scenario: Operator overrides dedicatedTenantImage to supply a pgvector-capable image

- **WHEN** an operator sets `postgresql.dedicatedTenantImage.repository` and
  `postgresql.dedicatedTenantImage.tag` in their values override (e.g. to a custom
  Bitnami-compatible image with pgvector built in)
- **THEN** the Helm chart renders without error, the override is visible in the rendered values,
  and the shared-instance `postgresql.image` is not affected

#### Scenario: Default dedicated tenant image value is documented in the chart

- **WHEN** the chart is rendered with no overrides to `postgresql.dedicatedTenantImage`
- **THEN** the key is present in the rendered values with `repository: pgvector/pgvector` and
  `tag: pg17`, and the adjacent comment cross-references the `dpf_01regulateddedicated` profile
  and explains that this value is an operator guide, not an automatically applied image

### Requirement: Document by-id operations MUST match the stored ObjectId

The system SHALL coerce a by-id document key to a BSON `ObjectId` (falling back to a string match for ids that are not valid ObjectIds) before querying, so that get/update/replace/delete by id operate on the stored document rather than silently no-op'ing.

#### Scenario: By-id get returns the stored document

- **WHEN** a client inserts a document and then issues `GET …/documents/{insertedId}` using the returned id
- **THEN** the system returns the stored document (`found:true`)

#### Scenario: By-id delete removes the stored document

- **WHEN** a client issues a DELETE for a real document id
- **THEN** the system removes the document and reports `deleted:1`

