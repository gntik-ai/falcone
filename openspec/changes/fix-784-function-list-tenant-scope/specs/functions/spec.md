# functions — spec delta for fix-784-function-list-tenant-scope

## MODIFIED Requirements

### Requirement: Function access MUST be scoped to the caller's tenant

The system SHALL constrain every function lookup by the caller's `tenant_id` and SHALL verify
function ownership on the invoke, get, and activations routes, so that a principal cannot invoke
or read another tenant's function, inline source, or activation logs.

The system SHALL ALSO enforce tenant ownership on the **workspace-scoped function LIST routes** —
`GET /v1/functions/workspaces/{workspaceId}/inventory` and
`GET /v1/functions/workspaces/{workspaceId}/actions` — which were previously unscoped (issue #784,
a Critical cross-tenant IDOR). Before returning any function data for a workspace, the control-plane
SHALL resolve the addressed workspace and verify that the caller's **verified** tenant owns it; when
the caller's tenant does not own the workspace (or the workspace does not exist), the control-plane
SHALL deny the request with `403` and SHALL return **no** function data — in particular it SHALL NOT
return another tenant's function metadata (e.g. `tenantId`, `resourceId`, `actionName`) or
`source.inlineCode`, and the response SHALL NOT distinguish a foreign workspace from a non-existent
one (no existence oracle). A superadmin/internal caller (no bound tenant) MAY read any workspace's
functions. The store query backing the LIST routes SHALL accept the caller's tenant as a predicate
(`fn_actions.tenant_id = $tenant`) so that, even if a handler is misused, a tenant-scoped read can
never return another tenant's rows; the predicate SHALL be omitted only for superadmin/internal
callers. No public route or response field is added or removed — the `403` response is already
declared for both LIST routes — so the runtime is brought into agreement with the published contract.

#### Scenario: Cross-tenant function access by resourceId is rejected

- **WHEN** an authenticated principal of Tenant B invokes, gets, or reads activations for a function `resourceId` owned by Tenant A
- **THEN** the system returns HTTP 404 or 403 and discloses no function source, output, or activation logs

#### Scenario: Own-tenant function access succeeds

- **WHEN** an authenticated principal invokes or reads a function that belongs to its own tenant
- **THEN** the system processes the request and returns the appropriate success status

#### Scenario: Cross-tenant function LIST is denied

- **WHEN** an authenticated caller whose verified tenant does **not** own `workspaceId` requests
  `GET /v1/functions/workspaces/{workspaceId}/inventory` or
  `GET /v1/functions/workspaces/{workspaceId}/actions`
- **THEN** the control-plane returns `403` with an error `code` and **no** function data — the response
  contains none of the other tenant's function metadata and **no** `source.inlineCode`
- **AND** no existence oracle is leaked (a foreign workspace and an unknown workspace are
  indistinguishable from the response)

#### Scenario: Own-tenant function LIST returns only the caller's functions

- **WHEN** a caller that owns `workspaceId` requests the inventory or actions LIST for that workspace
- **THEN** the control-plane returns `200` with the functions of that workspace **belonging to the
  caller's tenant** (including their `source.inlineCode`), and never any function belonging to another
  tenant

#### Scenario: Superadmin may read any workspace's functions

- **WHEN** a superadmin/internal caller (no bound tenant) requests the inventory or actions LIST for any
  `workspaceId`
- **THEN** the control-plane returns `200` with that workspace's functions (the cross-tenant
  administrative view is preserved), because the tenant predicate is omitted only for these callers
