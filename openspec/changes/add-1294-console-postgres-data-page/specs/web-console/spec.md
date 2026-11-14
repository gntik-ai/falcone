# PostgreSQL data editor migration

## ADDED Requirements

### Requirement: Data editor and API-key panel route
The next console SHALL lazily serve `/console/postgres/data` inside the authenticated
shell with no route permission guard. Until a database and a table are entered the
page SHALL show the select-table prompt and send no rows or api-keys request. A
blank schema SHALL fall back to `public`. All page text SHALL come from matching
es and en catalog keys, and no sample data SHALL render.

#### Scenario: Prompt before a target
- **WHEN** an authenticated user opens the page with an active workspace
- **THEN** the prompt renders and no rows or api-keys request is sent

#### Scenario: Target entered
- **WHEN** the user enters a database and a table
- **THEN** exactly one rows read and one api-keys read are sent for the active workspace

### Requirement: Workspace-required states
Without an active workspace the page SHALL render the shell workspace states and
send no rows or api-keys request. Loading SHALL render a loading state. Every
workspace-loading error, 403 included, SHALL render Reintentar, which SHALL call
`reloadWorkspaces` once. With workspaces the page SHALL offer a picker that calls
`selectWorkspace`; with none it SHALL link to `/console/workspaces` only when the
user can create workspaces and otherwise explain who can.

#### Scenario: Workspace error retry
- **WHEN** the workspaces fail to load with any status
- **THEN** Reintentar renders and calls `reloadWorkspaces` once

### Requirement: Row requests identical to legacy
Rows SHALL load with `page[size]`, `page[after]`, `countMode=exact` and one
`column=op.value` parameter per filter. An `in` filter SHALL split its value on
commas and trim each entry; a blank column SHALL be ignored. Insert SHALL send
`POST rows {values}`, edit `PATCH rows/by-primary-key?id= {changes}` without `id`
and delete `DELETE rows/by-primary-key?id=`, each followed by a rows reload.
Insert and edit JSON SHALL parse to an object, and a row without `id` SHALL not
be edited or deleted; each failure SHALL send no request.

#### Scenario: Filter and pager
- **WHEN** a filter is added or the pager moves
- **THEN** the filter resets the cursor and the pager sends `page[after]`

#### Scenario: Invalid JSON
- **WHEN** the new row JSON is not an object
- **THEN** the translated parse error renders and no request is sent

### Requirement: Busy guard across target changes
While an insert, edit or delete is pending, Insertar, Editar, Eliminar, Guardar,
Cancelar, Anterior and Siguiente SHALL stay disabled until the mutation settles,
even if the database, schema or table changes or the editor remounts. The
page-size select, the filters, the issue buttons and Revocar SHALL stay enabled.
While a save is pending the drawer SHALL refuse Cancelar, Escape and outside
clicks; when idle each SHALL close it and return focus to Editar.

#### Scenario: Target change during an insert
- **WHEN** the table field changes while an insert is pending
- **THEN** the controls stay disabled and the editor does not remount into a non-busy state

#### Scenario: Pending save
- **WHEN** a save is pending and the user presses Escape or Cancelar
- **THEN** the drawer stays open and no request is sent

### Requirement: Typed confirmation for irreversible actions
Eliminar and Revocar SHALL open a confirmation whose confirm button stays disabled
until the typed text equals the row id or the key prefix. Cancelar and Escape SHALL
close it without a request and return focus to the trigger. While the action runs
the confirmation SHALL refuse dismissal.

#### Scenario: Confirmed delete
- **WHEN** the row id is typed and the delete is confirmed
- **THEN** one DELETE by primary key is sent and the rows reload

#### Scenario: Cancelled revoke
- **WHEN** the user cancels the revoke confirmation
- **THEN** no request is sent

### Requirement: One-time masked key reveal
Issuing a key SHALL send `POST api-keys {keyType}` and reveal the key once in a
dialog, masked by default, with Copiar copying exactly the key. The key SHALL live
only in component memory and SHALL never reach storage, a toast, a live region or
a log. A new issue, closing the dialog or leaving the page SHALL drop it. The
read-only preview SHALL send `GET rows?page[size]=10` with the `apikey` header and
no `Authorization` header, keep `Accept`, `Content-Type`, `X-API-Version` and
`X-Correlation-Id`, and never refresh the console session.

#### Scenario: Issue and copy
- **WHEN** an anon key is issued and Copiar is activated
- **THEN** the dialog shows the key masked and the clipboard receives exactly the key

#### Scenario: Preview
- **WHEN** the preview runs
- **THEN** one GET is sent with `apikey`, `page[size]=10` and no `Authorization`

### Requirement: Local states
Rows 403 SHALL render no-access in place of the table; key-list 403 SHALL render
its own no-access and keep the rows. A rows 404 SHALL render not-found with Volver,
which SHALL clear the database and table, reset the schema to `public`, show the
prompt and focus Base de datos without a request. 500 and network failures SHALL
render an error-panel whose Reintentar repeats the identical request once; rows
from a failed read SHALL never be shown as fresh. An empty key list SHALL render
its own empty state. Mutation errors SHALL render an inline callout with the server message.

#### Scenario: Rows not found
- **WHEN** the rows read returns 404 and the user activates Volver
- **THEN** the prompt renders, the schema is `public`, Base de datos has focus and no request is sent

#### Scenario: Session refresh
- **WHEN** a rows read returns 401
- **THEN** one refresh POST and one replay follow, or a rejected refresh redirects to `/login` with the return path and no replay
