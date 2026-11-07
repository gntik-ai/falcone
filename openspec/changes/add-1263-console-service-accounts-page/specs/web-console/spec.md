## ADDED Requirements

### Requirement: Workspace service account directory

The next console SHALL serve `/console/service-accounts` from a lazy page that is
dispatched only while the route is flagged migrated. The page SHALL list the whole
collection returned by `GET /v1/workspaces/{workspaceId}/service-accounts` without
pagination, using the pinned kit and the es-default/en namespace.

#### Scenario: Rows and states

- **WHEN** the list loads
- **THEN** each row SHALL show name, client state and credential status as status tags,
  the revoked caption, the access projection and the expiry or an em dash.
- **AND** an unrecognized non-empty credential status SHALL show its raw value with a neutral tone.
- **WHEN** the list is empty
- **THEN** the first-run state SHALL point to the create form.
- **WHEN** the list fails with any status other than 403 or 404
- **THEN** an error panel SHALL show Reintentar and the request ID.
- **WHEN** it fails with 403 or 404
- **THEN** a no-access or not-found state SHALL render, the latter with a way back to workspace selection.

#### Scenario: Missing context

- **WHEN** there is no active organization, or its load failed
- **THEN** the blocked state SHALL render.
- **WHEN** workspaces failed to load for a loaded organization
- **THEN** a workspace error SHALL offer Reintentar, which sends one workspace read.
- **WHEN** no workspace is active
- **THEN** the workspace-required state SHALL offer a picker, a create link or the denied text.

### Requirement: Credential lifecycle actions

Create, Revelar, Rotar, Revocar and Eliminar SHALL require workspace write permission and
an active organization; otherwise they SHALL be disabled with their reason, never hidden.
Revelar and Rotar SHALL also be disabled for a revoked credential.

#### Scenario: Create

- **WHEN** a non-empty name is submitted, by button or Enter
- **THEN** one POST SHALL carry displayName, entityType `service_account` and desiredState `active`.
- **AND** the list SHALL be refetched once, the new id announced and the field cleared.

#### Scenario: Reveal and rotate

- **WHEN** Revelar succeeds
- **THEN** a dialog SHALL show the credential id, the expiry and the secret masked by default,
  with a toggle exposing `aria-pressed` and a copy action.
- **WHEN** the clipboard API is unavailable
- **THEN** Copiar SHALL show the manual-copy fallback at once.
- **WHEN** Rotar is confirmed by typing the exact name
- **THEN** one POST SHALL be sent, the fresh secret SHALL be shown once in a code block, and the
  list SHALL be refetched exactly once.
- **WHEN** Cancelar or Escape is used
- **THEN** no request SHALL be sent and focus SHALL return to Rotar.

#### Scenario: Revoke and delete

- **WHEN** the exact name is typed
- **THEN** Revocar or Eliminar SHALL send one request, show the irreversibility line, refetch
  the list and announce the outcome.
- **AND** nothing SHALL be sent before the name matches.

### Requirement: Failure handling

Each mutation SHALL report failures in its own surface: the create form, the credential result
region or the open confirmation. No disclosure SHALL open and no row SHALL change on failure.

#### Scenario: Mapped failures

- **WHEN** a mutation returns 403 or 404
- **THEN** a no-access or not-found state naming the account SHALL replace the surface body and
  focus SHALL move to Cerrar; Volver a la lista SHALL refetch and focus the heading.
- **WHEN** it returns 5xx or fails on the network
- **THEN** an error panel SHALL show Reintentar, take focus, and keep the typed name or form value;
  each activation SHALL send exactly one request.
- **WHEN** it returns 409 CREDENTIAL_REVOKED, 409 or 429
- **THEN** a localized alert SHALL carry the message in its description and a 429 SHALL allow confirming again.

#### Scenario: Network failure of a terminal action

- **WHEN** Reintentar follows a network failure of Revocar or Eliminar
- **THEN** one list read SHALL come first; an already applied change SHALL be reported without a write,
  otherwise exactly one write SHALL follow.

#### Scenario: Session refresh

- **WHEN** a request returns 401 and the refresh succeeds
- **THEN** the shared client SHALL resend once with a fresh Idempotency-Key and the page SHALL report the renewed session.
- **WHEN** the refresh fails
- **THEN** no resend SHALL occur, nothing SHALL open and the session SHALL end at login with the return path.

### Requirement: Context isolation

Everything bound to the tenant and workspace SHALL be reset when either changes.

#### Scenario: Switch with an open surface

- **WHEN** the tenant or workspace changes with a confirmation, disclosure or failure open
- **THEN** the surface SHALL close, no request SHALL be sent, toasts and the name field SHALL clear
  and focus SHALL land on the heading, or on the gate heading once workspaces finish loading.
- **AND** responses for the previous context SHALL be discarded.

### Requirement: Secret hygiene

The synthetic secret SHALL never reach console output, a live region, a title or a trace.

#### Scenario: Journeys and captures

- **WHEN** the disclosure journeys run in the browser
- **THEN** tracing SHALL be off, screenshots SHALL mask the secret and fixture secrets SHALL be non-key-shaped values.
