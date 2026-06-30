# web-console — spec delta for fix-754-provisioning-wizard-tenant-owner

## MODIFIED Requirements

### Requirement: Provisioning wizard permission gates include tenant_owner

The system SHALL grant `provision_database` and `publish_function` wizard access to principals
holding `tenant_owner` OR `workspace_admin`, matching the sibling `create_workspace` /
`invite_member` gates and the server's authorization for workspace data-plane provisioning. Existing
global operator behavior SHALL remain intact: `superadmin` and `platform_operator` principals remain
allowed by the shared wizard gate. Principals with only `tenant_member` or no recognized role SHALL
remain blocked by the client gate.

The server remains the final authorization authority. The console SHALL NOT pre-empt an action with a
stricter client-side permission gate when the server would authorize that action for the caller's
role; if the server rejects a submitted wizard request, the wizard SHALL surface that server result
instead of relying on a divergent client role policy.

#### Scenario: Tenant owner opens the create-database wizard

- **WHEN** a `tenant_owner` selects an active workspace and opens the create-database wizard from
  `/console/postgres` or `/console/mongo`
- **THEN** the provisioning wizard renders its steps (Workspace -> Motor/name -> Configuracion ->
  summary), with no "Acceso bloqueado" panel, and submission is allowed to reach the server

#### Scenario: Tenant owner opens the publish-function wizard

- **WHEN** a `tenant_owner` selects an active workspace and opens the publish-function wizard from
  `/console/functions`
- **THEN** the publish wizard renders its steps, with no "Acceso bloqueado" panel, and submission is
  allowed to reach the server

#### Scenario: UI authorization matches server authorization

- **WHEN** the server would authorize an action for a role (it does not return `403`)
- **THEN** the console SHALL NOT pre-empt that action with a stricter client-side permission gate
