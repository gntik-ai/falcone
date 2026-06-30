# web-console — spec delta for fix-795-workspace-docs-contract

## ADDED Requirements

### Requirement: Workspace documentation page uses the authenticated console docs API

The system SHALL load `/v1/workspaces/{workspaceId}/docs` from the web console using the active
authenticated console session, including the session bearer token on the request, and SHALL render the
returned workspace documentation payload: base URL, authentication instructions, enabled-service
snippets, and custom notes. The control-plane runtime SHALL route
`GET /v1/workspaces/{workspaceId}/docs` to the workspace documentation handler rather than returning
`404 NO_ROUTE`, and the handler SHALL accept the console's current API version header.

The system SHALL make custom documentation note create/edit/delete affordances visible only to callers
whose verified roles are authorized to mutate workspace documentation notes. Read-only workspace docs
callers SHALL be able to view existing custom notes without seeing mutation controls.

#### Scenario: Tenant owner opens workspace docs and receives rendered documentation

- **WHEN** a `tenant_owner` opens `/console/workspaces/{workspaceId}/docs`
- **THEN** the console sends `GET /v1/workspaces/{workspaceId}/docs` through the authenticated console
  session bearer flow
- **AND THEN** the control-plane returns HTTP 200 instead of `404 NO_ROUTE` or an unauthenticated
  error
- **AND THEN** the page renders the returned base URL, auth instructions, enabled-service snippets,
  and custom notes instead of the docs error state

#### Scenario: Workspace admin can manage custom documentation notes

- **WHEN** a caller with `workspace_admin` or `workspace_owner` opens
  `/console/workspaces/{workspaceId}/docs`
- **THEN** the page shows create, edit, and delete controls for custom documentation notes
- **AND THEN** create, update, and delete requests use the authenticated console session bearer flow
  and target `/v1/workspaces/{workspaceId}/docs/notes[/{noteId}]`

#### Scenario: Read-only docs caller cannot manage custom notes

- **WHEN** a caller without a workspace note-management role opens
  `/console/workspaces/{workspaceId}/docs`
- **THEN** the page renders existing custom notes as read-only content
- **AND THEN** it does not show note create, edit, or delete affordances
