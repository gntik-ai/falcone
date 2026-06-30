# web-console - spec delta for fix-781-auth-console-missing-routes

## ADDED Requirements

### Requirement: Auth page external applications are backed by served control-plane routes

The system SHALL either serve the external-applications/federation routes that `/console/auth`
calls, or not present the external-applications/federation management section as an actionable
capability. When the capability is presented, the control-plane routes
`/v1/workspaces/{workspaceId}/applications` and
`/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers` SHALL resolve to
real handlers for the caller's authorized workspace, and SHALL return a successful domain response
or a structured domain error. They SHALL NOT fall through to `404 NO_ROUTE`.

#### Scenario: Tenant owner opens the External applications section

- **WHEN** a tenant owner opens `/console/auth` and the section loads with
  `GET /v1/workspaces/{workspaceId}/applications?limit=100`
- **THEN** the request resolves to a real handler
- **AND THEN** the handler returns an external-application collection, possibly empty
- **AND THEN** the response is not `404 NO_ROUTE`

#### Scenario: Tenant owner creates an external application

- **WHEN** a tenant owner submits "Crear aplicación externa" with
  `POST /v1/workspaces/{workspaceId}/applications`
- **THEN** the request resolves to a real handler
- **AND THEN** the handler either accepts/stores the application or returns structured validation
  details such as `400 VALIDATION_ERROR`
- **AND THEN** the response is not `404 NO_ROUTE`

#### Scenario: External-applications section with backend present

- **WHEN** a tenant owner lists, creates, updates, or manages federated providers for an external
  application from `/console/auth`
- **THEN** the control-plane serves the corresponding workspace application or provider request
- **AND THEN** the console can reflect the returned collection, accepted mutation, or structured
  validation/domain error

#### Scenario: Tenant caller requests a foreign workspace application route

- **WHEN** a tenant-scoped caller requests an external-application or provider route for a workspace
  owned by another tenant
- **THEN** the route returns `404 WORKSPACE_NOT_FOUND`
- **AND THEN** the handler does not query or reveal that workspace's external-application rows
