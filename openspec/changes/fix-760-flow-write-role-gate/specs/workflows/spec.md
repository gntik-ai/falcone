# workflows — spec delta for fix-760-flow-write-role-gate

## ADDED Requirements

### Requirement: Flow-definition writes require a write-capable tenant/workspace role

The control-plane executor SHALL authorize a flow-definition write — create, update, delete, or
publish a version (`POST` / `PATCH` / `DELETE /v1/flows/workspaces/{workspaceId}/flows[/{flowId}]` and
`POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions`) — by the verified caller's **role**,
not tenant/workspace membership alone. It SHALL require a write-capable tenant/workspace role
(`tenant_owner` / `tenant_admin` / `workspace_owner` / `workspace_admin`, or a `platform_admin` /
`superadmin`) and SHALL reject a principal whose verified roles are known and contain no such role
(e.g. a read-only `tenant_viewer`, or a `tenant_developer`) with `403 FORBIDDEN`, **persisting
nothing** (the definition/version store is never written), on every workspace and every stage
(development / staging / production). The role check SHALL be evaluated AFTER tenant identity is
established and AFTER the cross-tenant ownership check (so a caller whose verified tenant does not own
the workspace continues to be denied by the existing cross-tenant path, which takes precedence and
leaks neither existence nor role), and BEFORE any store read or write side effect. Flow EXECUTION
operations (start / cancel / retry / signal a run, and get/list executions) and read operations
(list/get a definition or version, the task-type catalog, and the read-only `validate` check) SHALL
NOT be gated by this requirement; their existing authorization (identity, cross-tenant run ownership)
is unchanged. The authorized store calls SHALL remain scoped by the caller's verified `tenantId` /
`workspaceId`.

#### Scenario: A read-only viewer cannot create, update, delete, or publish a flow definition

- **WHEN** a principal whose only role is `tenant_viewer` (read-only; a member of the owning tenant)
  issues `POST` (create), `PATCH` (update), `DELETE` (delete), or `POST .../versions` (publish) on
  `/v1/flows/workspaces/{workspaceId}/flows[/{flowId}]` for a workspace of its tenant, including
  production
- **THEN** the executor responds `403 FORBIDDEN` and no flow definition or version is created,
  modified, deleted, or published (the definition/version store is never written)

#### Scenario: A non-admin developer role is likewise denied a flow-definition write

- **WHEN** a principal whose only role is `tenant_developer` (or any other role that is not
  write-capable) issues a create / update / delete / publish on the flow-definition path for any
  workspace of its tenant
- **THEN** the executor responds `403 FORBIDDEN` and nothing is persisted

#### Scenario: A write-capable role is still authorized

- **WHEN** a principal carrying a write-capable role — `tenant_owner`, `tenant_admin`,
  `workspace_owner`, `workspace_admin`, `platform_admin`, or `superadmin` — issues a create / update /
  delete / publish on the flow-definition path for a workspace of its tenant
- **THEN** the operation is authorized and succeeds exactly as before (`201` on create and publish,
  `200` on update and delete), and the write is performed against the store scoped to the caller's
  verified tenant and workspace

#### Scenario: Execution and read operations are not write-gated

- **WHEN** a member of the owning tenant (including a `tenant_viewer`) lists or reads a flow definition
  or version, fetches the task-type catalog, runs the read-only `validate` check, or performs an
  execution-lifecycle operation (start / cancel / retry / signal a run, list/get executions) that its
  existing authorization permits
- **THEN** the operation is unaffected by this requirement (the role gate applies only to
  definition writes)

#### Scenario: Cross-tenant isolation is preserved (cross-tenant denial takes precedence)

- **WHEN** a principal whose verified tenant does not own the addressed workspace issues a flow-
  definition write on that workspace's path
- **THEN** the request is denied by the existing cross-tenant path (which is evaluated before this role
  gate, leaking neither existence nor role) and nothing is persisted — the role gate does not weaken or
  reorder the cross-tenant check
