# secrets — spec delta for fix-771-workspace-secret-delete-contract

## ADDED Requirements

### Requirement: Workspace secret DELETE conforms to the published response contract

The control-plane SHALL make `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}`
agree with its published OpenAPI operation. For a caller authorized to mutate the verified
tenant/workspace, the operation SHALL return `204 No Content` with no response body when the named
secret existed and was removed, and SHALL return `404 SECRET_NOT_FOUND` when the named secret is not
present. The handler SHALL validate the `secretName` path parameter before probing the backend. The
tenant/workspace isolation and role-authorization ordering SHALL remain unchanged: cross-tenant
workspace access returns `404 WORKSPACE_NOT_FOUND` before any role or secret-existence probe, and an
own-tenant non-admin caller returns `403 FORBIDDEN` before any secret-existence probe or delete side
effect.

#### Scenario: Delete an existing secret

- **WHEN** an authorized tenant admin or superadmin calls
  `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` for a secret that exists in the
  verified workspace
- **THEN** the control-plane deletes that secret and responds `204 No Content` with no response body

#### Scenario: Delete a missing secret

- **WHEN** an authorized tenant admin or superadmin calls
  `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` for a secret name that is not
  present in the verified workspace
- **THEN** the control-plane responds `404 SECRET_NOT_FOUND` and does not call the delete backend

#### Scenario: Invalid secret name is rejected before backend access

- **WHEN** an authorized caller uses a `secretName` path parameter that does not match
  `^[a-z][a-z0-9_-]{0,62}$`
- **THEN** the control-plane responds `400 VALIDATION_ERROR` and does not probe or mutate the secrets
  backend
