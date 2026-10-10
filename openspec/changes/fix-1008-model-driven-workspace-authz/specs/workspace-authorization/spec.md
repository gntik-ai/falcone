## ADDED Requirements

### Requirement: Model-driven workspace authorization

The workspace GET and database/bucket/topic creation routes SHALL decide from the
shipped model using verified realm roles and tenant/workspace bindings. The model
SHALL load once at module initialization. Unknown roles/actions SHALL deny.

#### Scenario: Tenant roles read their tenant's workspaces

- **WHEN** tenant_owner, tenant_admin, tenant_developer or tenant_viewer reads a
  workspace in its verified tenant, with any or no workspace binding
- **THEN** GET returns 200

#### Scenario: Workspace roles require a matching binding

- **WHEN** workspace_admin, workspace_developer or workspace_viewer reads a workspace
- **THEN** GET returns 200 only in the verified tenant with the workspace in workspaceIds
- **AND** absent, empty or different-workspace bindings return 403

#### Scenario: Cross-tenant and same-tenant denials remain distinct

- **WHEN** a non-platform caller reads another tenant's workspace
- **THEN** GET returns 403 with the existing another-tenant message, or its existing 404
- **WHEN** a same-tenant caller lacks workspace authority
- **THEN** its 403 message does not claim another tenant

### Requirement: Provisioning requires administration

Creation SHALL require database.admin, bucket.admin or topic.admin respectively.
Only these three model grants SHALL move from denials to grants for tenant_owner
and tenant_admin. Shared management resolvers SHALL retain their existing gates.

#### Scenario: Authorized administrators create resources

- **WHEN** tenant_owner or tenant_admin creates in its verified tenant, or a
  workspace_admin creates in its bound workspace in that tenant
- **THEN** database provision returns 201 or 409 DB_ALREADY_PROVISIONED
- **AND** bucket and topic creation return 201

#### Scenario: Write grants do not authorize administration

- **WHEN** tenant_developer, tenant_viewer, workspace_developer, workspace_viewer,
  or an unbound workspace_admin attempts those creates
- **THEN** the response is 403

### Requirement: Unbound workspace roles fail closed on executor writes

Structural writes SHALL deny workspace_owner, workspace_admin, workspace_developer
and workspace_viewer when workspaceIds is absent or empty. Broad tenant/platform
administrators and the earlier API-key identity denial SHALL remain unchanged.

#### Scenario: Consistent reads and writes

- **WHEN** any of the seven tenant/workspace roles can issue a workspace API key
  or PUT its LLM provider
- **THEN** it can also GET that workspace

#### Scenario: Provider and key writes require the workspace binding

- **WHEN** an unbound or differently bound workspace role attempts API-key issue/
  revoke or LLM/embedding-provider PUT/DELETE
- **THEN** it receives 403 before a structural side effect
