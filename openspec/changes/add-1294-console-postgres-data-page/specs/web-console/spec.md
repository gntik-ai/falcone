# PostgreSQL data editor migration

## ADDED Requirements

### Requirement: Routed data editor with explicit states
The next console SHALL lazily serve `/console/postgres/data` inside the authenticated shell without a route guard.
Every visible string, accessible name, placeholder, toast and error SHALL come from matching es and en keys of
`pages.console-postgres-data-page`. No sample data SHALL render.

#### Scenario: Target required before any request
- **WHEN** the page opens with an active workspace and no database or table
- **THEN** it shows the select-table prompt and sends no rows or api-keys request
- **AND** a blank schema falls back to `public`

#### Scenario: Workspace required
- **WHEN** no workspace is active
- **THEN** loading renders the loading state, every load error (403 included) renders Reintentar which calls reloadWorkspaces,
  the picker calls selectWorkspace, and the create link appears only with the permission, otherwise the denial note
- **AND** no rows or api-keys request is sent

#### Scenario: Load failures stay local
- **WHEN** rows return 403, 404, 500 or a network failure
- **THEN** the rows area shows no-access, not-found with Volver, or an error panel with the request id and Reintentar
- **AND** previously loaded rows are cleared and the key panel keeps its own state

### Requirement: Request parity and allowlist
The page SHALL send rows and api-keys requests through console-api with the legacy method, path, query and body, and
SHALL send no other request than the shell bootstrap and the session refresh.

#### Scenario: Rows reads and writes
- **WHEN** the user filters, pages, inserts, edits or deletes
- **THEN** it sends `GET rows` with `page[size]`, `page[after]`, `countMode=exact` and one `column=op.value` per filter,
  `POST rows {values}`, `PATCH by-primary-key?id= {changes}` without id and `DELETE by-primary-key?id=`
- **AND** every effect-driven rows reload also reloads `GET api-keys`

#### Scenario: Session refresh on 401
- **WHEN** a rows request returns 401
- **THEN** exactly one refresh POST is sent and, when it succeeds, exactly one replay with the refreshed session
- **AND** when the refresh is rejected there is no replay and the user is redirected to /login with the return path

### Requirement: Mutation busy guard and drawer
While an insert, patch or delete is pending, Insertar, Editar, Eliminar, Guardar, Cancelar, Anterior and Siguiente SHALL
stay disabled, even after the database, schema or table changes. The page-size select, filters, issue buttons and Revocar
stay enabled.

#### Scenario: Busy across a target change
- **WHEN** a slow insert is pending and the user changes the table
- **THEN** the mutation controls remain disabled until the request settles
- **AND** the editor does not remount into a non-busy state

#### Scenario: Drawer dismissal
- **WHEN** a patch is pending
- **THEN** Cancelar, Escape and an outside press leave the drawer open and send no request
- **AND** when idle each of them closes it and focus returns to Editar

#### Scenario: Focus after Save
- **WHEN** Guardar succeeds and the rows reload
- **THEN** focus lands on the edited row's action or another stable control, never on body

### Requirement: Cursor pagination per target
Paging SHALL use the page cursor and a stack of previous cursors, keyed by target.

#### Scenario: Revisited target
- **WHEN** the user returns to a previously visited database, schema or table
- **THEN** it starts at the first page with an empty cursor stack and no stale cursor is sent

### Requirement: Irreversible actions need typed confirmation
Row delete and key revoke SHALL open a type-to-confirm dialog whose confirm button stays disabled until the exact row id or
key prefix is typed.

#### Scenario: Cancel and confirm
- **WHEN** the user cancels or presses Escape
- **THEN** no request is sent and focus returns to the triggering button
- **WHEN** the exact text is typed and confirmed
- **THEN** one DELETE is sent, the data reloads and the result is announced

### Requirement: One-time key reveal and preview
Issued keys SHALL be held only in component memory, masked by default, copyable exactly once, and dropped on the next issue,
when the reveal closes and on unmount. The read-only preview SHALL send the key in the apikey header and no Authorization.

#### Scenario: Issue and preview
- **WHEN** the user issues an anon or service key
- **THEN** `POST api-keys {keyType}` reveals the key masked with the shown-once warning, fetch and curl snippets and Copiar
- **AND** the preview sends `GET rows?page[size]=10` with apikey, Accept, Content-Type, X-API-Version and X-Correlation-Id, no Authorization
- **AND** the key never reaches storage, toasts or baselines

### Requirement: Accessibility and verification
Focus SHALL remain visible and return to the triggering control after every dialog or drawer. Wide tables SHALL scroll inside their
container at 375, 768 and 1280 pixels. The mocked journey SHALL isolate each action's writes, query hidden background controls
with includeHidden and register expected failures as diagnostics.

#### Scenario: Locale and data values
- **WHEN** the locale check scans the page
- **THEN** the schema and table heading and other data values are exempt, while interface copy is checked in es and en

#### Scenario: Browser checks run in CI
- **WHEN** Chromium is unavailable locally
- **THEN** parity, axe and viewport checks run in the pull request CI and screenshot approval stays with the operator
