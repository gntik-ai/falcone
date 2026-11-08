## ADDED Requirements

### Requirement: Auth/IAM management page

The next console SHALL serve `/console/auth` from a lazy page dispatched only while the route is
flagged migrated and behind the superadmin guard. A non-superadmin SHALL be denied by the guard
and the page SHALL send no request. With no active organization, or an organization without a
console realm, the page SHALL show the matching empty message and send no request.

#### Scenario: Initial load

- **WHEN** an organization with a console realm and an active workspace loads
- **THEN** the page SHALL send, apart from the shell bootstrap requests, exactly five reads:
  users, roles, scopes and clients of the realm with `page[size]=100`, and the workspace applications
  with `limit=100`.
- **AND** it SHALL send no mutation and no `/v1/metrics/*` request.
- **AND** the kpi tiles, the scope and client tables, the federated provider table and the connection
  snippets SHALL render independently, each with its own loading, empty and failure state.

#### Scenario: Section failures

- **WHEN** a section read fails with 403
- **THEN** that section SHALL show the localized no-access text and not the backend message.
- **WHEN** it fails with 404
- **THEN** that section SHALL show not-found with a link back to the overview or the workspaces.
- **WHEN** a realm section fails with a network error, 408, 429 or 5xx
- **THEN** it SHALL show the status, the request id and Reintentar, which re-sends only that read.
- **WHEN** a realm section fails with another status
- **THEN** it SHALL show no Reintentar and say that reloading the page will not resolve the error.
- **WHEN** the applications read fails with any other status
- **THEN** it SHALL show Reintentar, which sends exactly one applications read.

### Requirement: External applications and federated providers

Create, edit, soft delete, and provider add, edit, toggle and detach SHALL send the legacy
request and body and SHALL be disabled, not hidden, while no workspace is selected. Provider actions
SHALL be disabled for API key applications.

#### Scenario: Mutations and reload

- **WHEN** a mutation succeeds
- **THEN** exactly one applications read SHALL follow, and the result SHALL be announced by toast and live region.
- **WHEN** a mutation fails
- **THEN** an inline destructive callout SHALL show a localized message, the form values SHALL be kept,
  and no applications read SHALL be sent.
- **WHEN** validation fails
- **THEN** a validation summary SHALL link to each invalid field and no request SHALL be sent.

### Requirement: IAM client wizard

The wizard SHALL submit one idempotent `POST /v1/workspaces/{workspaceId}/iam/clients` with
`clientType`, `clientId`, `redirectUris` (empty for a service account), `scopes` and `permissions: []`.

#### Scenario: Secret handling

- **WHEN** the response carries a `clientSecret`
- **THEN** the secret SHALL NOT appear in the DOM, a toast, the live region, the console, local storage or session storage.
- **AND** only `iamClientId` SHALL be kept, and no applications read SHALL follow.

#### Scenario: Failure and permission

- **WHEN** the submit fails
- **THEN** the review step SHALL show an error panel with Reintentar and keep every entered value.
- **WHEN** the principal lacks `iam.clients.manage`
- **THEN** the wizard SHALL show the blocked state with the deny reason and no stepper.
