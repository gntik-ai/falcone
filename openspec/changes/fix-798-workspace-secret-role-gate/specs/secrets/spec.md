# secrets — spec delta for fix-798-workspace-secret-role-gate

## ADDED Requirements

### Requirement: Workspace secret mutations require an admin tenant role

The control-plane SHALL authorize a Workspace Secret create, replace, or delete
(`POST`/`PUT`/`DELETE /v1/functions/workspaces/{workspaceId}/secrets[/{secretName}]`) by the verified
caller's tenant **role**, not tenant membership alone. It SHALL require an administrative tenant role
— `tenant_owner` / `tenant_admin`, or a platform / superadmin (internal) caller — and SHALL deny a
non-admin tenant member (`tenant_developer`, `tenant_viewer`; verified actor type `tenant_member`)
with `403 FORBIDDEN`, persisting/deleting nothing, on every workspace and every stage
(dev / staging / production). The role check SHALL be evaluated AFTER the existing tenant/isolation
check (`ownedWorkspace`), so that a caller whose verified tenant does not own the workspace continues
to receive `404 WORKSPACE_NOT_FOUND` (the `404` taking precedence over the `403`, leaking neither
existence nor own-tenant-vs-other-tenant), and BEFORE any value validation, existence probe, or write
side effect. Read operations (`GET` list and `GET` by name) SHALL remain available to any member of
the owning tenant and SHALL NOT be role-gated (secret values stay write-only regardless).

#### Scenario: A read-only viewer cannot create a secret on the production workspace

- **WHEN** a `tenant_viewer` (a member of the owning tenant, verified actor type `tenant_member`) calls
  `POST /v1/functions/workspaces/{prodWs}/secrets` for its tenant's production workspace
- **THEN** the control-plane responds `403 FORBIDDEN` and creates nothing (the vault write is never
  performed)

#### Scenario: A non-admin developer cannot replace or delete a secret on any workspace

- **WHEN** a `tenant_developer` (a member of the owning tenant, verified actor type `tenant_member`)
  calls `PUT` or `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` for any workspace
  of its tenant, including production
- **THEN** the control-plane responds `403 FORBIDDEN` and replaces/deletes nothing (the vault write is
  never performed)

#### Scenario: An admin role or superadmin still succeeds

- **WHEN** a `tenant_owner` / `tenant_admin` of the owning tenant, or a superadmin / internal caller,
  performs `POST` / `PUT` / `DELETE` on the secrets path
- **THEN** the operation succeeds exactly as before (`201` on create, `200` on replace and delete) and
  the value is persisted / removed

#### Scenario: Reads remain available to a tenant member

- **WHEN** a `tenant_member` of the owning tenant calls `GET` list or `GET` by name on the secrets path
- **THEN** the control-plane responds `200` with the `FunctionWorkspaceSecret` metadata only (no
  value), unchanged by this requirement

#### Scenario: Cross-tenant isolation is preserved (404 before 403)

- **WHEN** a `tenant_member` whose verified `tenantId` does not equal the workspace's `tenant_id` calls
  `POST` / `PUT` / `DELETE` on the secrets path for that workspace
- **THEN** the control-plane responds `404 WORKSPACE_NOT_FOUND` (the `404` takes precedence over the
  role `403`, leaking neither existence nor role), and nothing is persisted / deleted
