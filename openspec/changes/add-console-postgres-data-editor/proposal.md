## Why

`apps/web-console/src/pages/ConsolePostgresPage.tsx` is read-only/preview today. All
data-fetching helpers (`loadDatabases`, `loadSchemas`, `loadTables`, `loadColumns`,
`loadIndexes`, `loadPolicies`, `loadSecurity`) call `requestConsoleSessionJson` with
`GET` only. Mutation paths use `executionMode: 'preview'` and `dryRun: true` (lines
505-519, 527-569), returning `PgMutationAccepted.ddlPreview` without ever executing
DDL. Row-level CRUD is entirely absent — there are no calls to the `/v1/postgres/…/rows`
family. The API-keys panel does not exist; `ConsoleServiceAccountsPage` is the only
credential surface, and it does not expose Supabase anon/service keys. The three
backend families needed (`add-postgres-ddl-execute`, `add-postgres-data-crud-execute`,
`add-app-api-keys`) are separate change proposals that deliver the real endpoints.
Without a capable console UI, developers cannot manage their Postgres schema, edit rows,
or obtain the anon key + frontend snippet needed to query their data from a client app.

## What Changes

- **DDL execution panel**: upgrade `ConsolePostgresPage` to submit `executionMode:
  "execute"` (without `dryRun`) when a user confirms a DDL operation (CREATE TABLE,
  ADD COLUMN, CREATE INDEX). On success, reload the relevant tree level and display a
  success confirmation. Surface backend errors (message only, no stack trace).
- **Data grid**: add a data tab on the selected-table view that calls
  `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/rows` with
  filter/pagination params, and exposes INSERT, UPDATE, DELETE row actions via the
  data-CRUD API family. Errors are surfaced as inline banner messages.
- **API-keys panel**: add a new `/console/workspaces/:workspaceId/postgres` or in-page
  panel that calls the app-api-keys family (`/v1/postgres/databases/{db}/keys`) to
  mint an anon key (shown once in a masked field with a copy button), rotate or revoke
  it, and display a copy-paste frontend JavaScript snippet (PostgREST endpoint + anon
  key).
- **`src/services/` client modules**: add typed service modules for the three API
  families (`postgresDataApi.ts`, `postgresDdlApi.ts`, `postgresKeysApi.ts`) consumed
  by `ConsolePostgresPage` and the new keys panel, using `requestConsoleSessionJson`.

## Capabilities

### New Capabilities

_(none — this change extends an existing page within the existing data-services capability)_

### Modified Capabilities

- `data-services`: extend `ConsolePostgresPage` with DDL execution, row-level data
  editing, and an API-keys panel backed by the three new backend API families; add
  typed service-layer modules under `apps/web-console/src/services/`.

## Impact

- `apps/web-console/src/pages/ConsolePostgresPage.tsx` — replace preview-only DDL
  buttons with execute-mode submission; add a data grid tab for row CRUD; add an
  API-keys panel section.
- `apps/web-console/src/services/postgresDdlApi.ts` — new; typed wrapper over the
  DDL execute endpoint family (`/v1/postgres/…/tables`, `/v1/postgres/…/columns`,
  `/v1/postgres/…/indexes` with `executionMode: "execute"`).
- `apps/web-console/src/services/postgresDataApi.ts` — new; typed wrapper over the
  row CRUD family (`/v1/postgres/…/rows` GET/POST/PATCH/DELETE).
- `apps/web-console/src/services/postgresKeysApi.ts` — new; typed wrapper over the
  app-api-keys family (`/v1/postgres/databases/{db}/keys` GET/POST/DELETE/PATCH).
- Prerequisite changes (back-end only, not in scope here): `add-postgres-ddl-execute`,
  `add-postgres-data-crud-execute`, `add-app-api-keys`.
