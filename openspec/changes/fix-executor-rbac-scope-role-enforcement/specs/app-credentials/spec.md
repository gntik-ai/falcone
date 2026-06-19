# app-credentials — spec delta for fix-executor-rbac-scope-role-enforcement

## MODIFIED Requirements

### Requirement: Scope enforcement rejects requests missing required scopes

The system SHALL enforce API-key scopes on the privilege-escalating data-plane operations INDEPENDENTLY
of the gateway: the executor SHALL reject (403) any data write whose authoritative API-key credential
lacks `data:write`, and any DDL operation whose credential lacks `ddl:write`, so scope enforcement holds
on every deployment profile even when the gateway `scope-enforcement` plugin is not wired. Reads remain
the baseline capability every key carries (`data:read`) and are not gated by this check. When the gateway
scope plugin IS active it remains the first line of enforcement; the executor check is defense-in-depth.
The data-plane scope check applies only to API-key credentials (which carry the data scope vocabulary);
JWT / admin / gateway-header identities are governed by roles + RLS and SHALL NOT be denied by it.

#### Scenario: read-only key write is denied

- **WHEN** a request uses an API key whose scopes are `["data:read"]` to perform a write
  (`POST .../documents` or `POST .../rows`)
- **THEN** the executor returns `403` (the write is not performed)

#### Scenario: key without ddl:write cannot run DDL

- **WHEN** a request uses an API key whose scopes are `["data:read","data:write"]` to run DDL
  (`POST /v1/postgres/databases/{db}/schemas`)
- **THEN** the executor returns `403` (the DDL is not performed)

#### Scenario: SERVICE key with sufficient scopes succeeds

- **WHEN** a request uses a valid SERVICE key whose scope set includes the scope the operation requires
- **THEN** the request proceeds normally (not rejected by the scope check)

#### Scenario: an admin JWT without data scopes is not subject to the data-plane scope check

- **WHEN** a verified admin/user JWT (no `data:*` scopes; not an API key) performs a data-plane operation
- **THEN** the data-plane scope check does not deny it (authorization is governed by roles + RLS)

#### Scenario: gateway-level scope enforcement still rejects a missing scope

- **WHEN** the gateway scope plugin is active and a client uses a key lacking a route's required scope
- **THEN** the gateway returns 403 before the request reaches the executor

## ADDED Requirements

### Requirement: API-key management requires an administrative role

The system SHALL restrict API-key management — issuance, listing, rotation, and revocation under
`/v1/workspaces/{workspaceId}/api-keys` — to administrative roles. When the caller's roles are known
(a verified JWT or gateway-injected `x-actor-roles`), the executor SHALL deny (403) a request to a
key-management route whose role set contains no administrative role (`tenant_owner`, `tenant_admin`,
`workspace_owner`, `workspace_admin`, or a platform admin role). An API key SHALL NOT manage API keys.
When the caller's roles are unknown (no role claims and no `x-actor-roles`), the role check SHALL defer to
the other authorization gates so that legitimate admin tokens and the trusted-gateway path are not
regressed.

#### Scenario: non-admin role cannot issue API keys

- **WHEN** a caller whose roles are `["tenant_developer"]` calls `POST /v1/workspaces/{id}/api-keys`
- **THEN** the request is denied (403) and no key is issued

#### Scenario: admin role may issue API keys

- **WHEN** a caller whose roles include `tenant_owner` (or another admin role) calls
  `POST /v1/workspaces/{id}/api-keys` for a workspace its own tenant owns
- **THEN** the request is not denied by the role check (issuance proceeds)

#### Scenario: a credential with no known roles is not blocked by the role check

- **WHEN** a verified admin token with no role claims calls `POST /v1/workspaces/{id}/api-keys` for its
  own tenant's workspace
- **THEN** the role check does not reject it (the cross-tenant / workspace-binding gates still apply)

#### Scenario: an API key cannot manage API keys

- **WHEN** a request authenticated with an API key targets a `/api-keys` management route
- **THEN** the executor returns 403
