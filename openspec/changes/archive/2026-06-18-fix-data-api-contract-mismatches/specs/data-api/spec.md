# data-api — spec delta for fix-data-api-contract-mismatches

## ADDED Requirements

### Requirement: Data-API field/path mismatches (mongo provision, fn inlineCode, bulk path, apikey casing)

The data-plane handlers SHALL accept the documented public request shapes and return
schema-consistent responses across these four surfaces:

- Mongo database provisioning SHALL accept the database name as `databaseName` (in addition to `name`).
- Function deploy SHALL accept the nested source shape `{ source: { inlineCode } }` (or `source.code`)
  in addition to a bare string source, storing the code string so invocation runs the function body.
- Postgres bulk insert SHALL be reachable at the documented catalog path
  `.../tables/{tableName}/bulk/insert` (in addition to `.../tables/{tableName}/rows/bulk/insert`).
- The API-key list response SHALL use the same camelCase field names as the mint response
  (`keyType`, `prefix`, `createdAt`), not snake_case.

#### Scenario: mongo provision accepts databaseName

- **WHEN** a mongo provision request supplies `{ engine: "mongodb", databaseName }`
- **THEN** the database is created (no `database name is required` 400)

#### Scenario: function deploy accepts the nested source shape

- **WHEN** a function is deployed with `{ source: { inlineCode } }` and then invoked
- **THEN** the function body runs and returns its result (the source object is not stringified)

#### Scenario: bulk insert resolves at the documented catalog path

- **WHEN** a bulk insert is sent to `.../tables/{tableName}/bulk/insert`
- **THEN** the rows are inserted (201) — the catalog path no longer 404s

#### Scenario: api-key list and mint responses are schema-consistent

- **WHEN** API keys are listed after one is minted
- **THEN** each list item uses the camelCase shape (`keyType`, `createdAt`) matching the mint response
