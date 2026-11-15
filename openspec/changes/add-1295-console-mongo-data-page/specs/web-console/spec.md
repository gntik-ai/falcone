# MongoDB data editor migration

## ADDED Requirements

### Requirement: Routed document editor with explicit states
The next console SHALL lazily serve `/console/mongo/data` inside the authenticated shell without a route guard. Every
visible string, accessible name, placeholder, toast and error SHALL come from matching es and en keys of
`pages.console-mongo-data-page`. No sample data SHALL render.

#### Scenario: Target required before any request
- **WHEN** the page opens with an active workspace and no database or collection
- **THEN** it shows the start prompt and sends no request beyond the shell bootstrap

#### Scenario: Workspace required
- **WHEN** no workspace is active
- **THEN** loading renders the loading state, every load error renders Reintentar which calls reloadWorkspaces, the picker
  calls selectWorkspace, and the create link appears only with the permission, otherwise the denial note
- **AND** no Mongo request is sent

#### Scenario: Load failures stay local
- **WHEN** the document list returns 403, 404, 500 or a network failure
- **THEN** the list area shows no-access, not-found with Volver, or an error panel with the request id and Reintentar
- **AND** previously loaded documents are cleared

### Requirement: Request parity and allowlist
The page SHALL send only the document list, insert, update and delete requests, the anonymous-key issue request, the
apikey preview and the shell bootstrap and session refresh, with the legacy method, path, query and body.

#### Scenario: Reads and writes
- **WHEN** the user pages, filters, inserts, edits or deletes
- **THEN** it sends `GET .../documents` with `page[size]`, `page[after]` and `filter` only when non-empty,
  `POST .../documents {document}`, `PATCH .../documents/{id} {update}` without `_id` or `id` and `DELETE .../documents/{id}`
- **AND** applying or clearing the filter, changing the page size, and changing the database or collection drop `page[after]`

#### Scenario: Session refresh on 401
- **WHEN** a session request returns 401
- **THEN** exactly one refresh POST is sent and, when it succeeds, exactly one replay with the refreshed session
- **AND** when the refresh is rejected there is no replay and the user is redirected to /login

### Requirement: Destructive and credential safety
Deleting a document SHALL require typing its `_id` exactly. The issued anonymous key SHALL be shown once and held in
memory only.

#### Scenario: Typed-id delete with a failure
- **WHEN** the user opens Eliminar and types a different or partial id
- **THEN** the confirm button stays disabled and no DELETE is sent
- **AND** after a failed DELETE the dialog stays open with the error and request id, the typed id and focus inside, and
  confirming again sends exactly one more DELETE

#### Scenario: Preview without a session
- **WHEN** the preview runs with the issued key
- **THEN** it sends `GET .../documents?page[size]=10` with an apikey header and no Authorization header
- **AND** a 401 shows a local error with no refresh, replay or logout
