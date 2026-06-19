# gateway — spec delta for add-gateway-realtime-config-identity

## ADDED Requirements

### Requirement: CDC capture listing resolves the workspace from the request path

The system SHALL resolve the workspace for `GET /v1/realtime/workspaces/{workspaceId}/pg-captures`
from the URL path segment `{workspaceId}` (falling back to a trusted `x-workspace-id` header when
present), so a tenant-scoped caller that carries no per-workspace claim (e.g. a tenant_owner JWT)
can list the workspace's captures. The tenant SHALL be taken ONLY from the trusted `x-tenant-id`
header (never the JWT payload), and the capture read SHALL remain tenant-scoped.

#### Scenario: tenant-scoped caller lists a workspace's captures

- **WHEN** a caller with a trusted `x-tenant-id` (and no `x-workspace-id` claim) requests `GET /v1/realtime/workspaces/{ws}/pg-captures` for a workspace it owns
- **THEN** the response is `200` with the captures for that `(tenant, workspace)`

#### Scenario: a cross-tenant workspace id leaks nothing

- **WHEN** a caller addresses a `{workspaceId}` belonging to a different tenant in the path
- **THEN** the tenant-scoped read returns no rows (no cross-tenant capture is revealed)

#### Scenario: no trusted tenant header is rejected

- **WHEN** the request carries no trusted `x-tenant-id` header (e.g. only a forged Bearer JWT)
- **THEN** the response is `401` and no datastore read occurs

### Requirement: Platform config catalog reads accept a platform operator without a tenant claim

The system SHALL allow the tenant-agnostic / path-addressed platform config catalog reads
(`/v1/admin/config/format-versions` and the config `export/domains` listing) to be served for a
platform operator (superadmin/sre) or a caller holding the `platform:admin:config:export` scope,
even when the caller carries no `x-tenant-id`. A request carrying no trusted identity signal at all
(no tenant, no roles, no scopes) SHALL still be rejected with `401`. Every other tenant-scoped
config action SHALL continue to require `x-tenant-id` (default `requireTenant:true`).

#### Scenario: superadmin reads the supported config format versions

- **WHEN** a superadmin (trusted `x-actor-roles: superadmin`, no `x-tenant-id`) calls `GET /v1/admin/config/format-versions`
- **THEN** the response is `200` with the supported format-version registry

#### Scenario: forged token with no trusted headers is rejected

- **WHEN** the request presents only a forged Bearer JWT and no trusted `x-actor-*` / `x-tenant-id` headers
- **THEN** the response is `401` (the JWT payload is never treated as identity)
