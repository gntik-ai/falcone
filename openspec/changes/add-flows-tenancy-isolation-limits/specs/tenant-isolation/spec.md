## ADDED Requirements

### Requirement: Temporal visibility queries are always bounded to the authenticated tenant

The system SHALL ensure that no Temporal visibility query (list executions, count executions, or any search against the Temporal visibility store) can return executions belonging to a different tenant, even when a caller crafts query parameters that attempt to remove, broaden, or override the server-injected `tenantId` search-attribute filter. The enforcement mechanism MUST be server-side and MUST NOT rely on clients supplying correct filter values.

#### Scenario: Injected search-attribute filter cannot be overridden by client query parameters

- **WHEN** an authenticated tenant-A caller submits a list-executions request whose query string contains a `query` or `filter` parameter that omits or contradicts the `tenantId = A` constraint
- **THEN** the system MUST overwrite any client-supplied tenantId filter with the value derived from the authenticated identity and MUST return only tenant A's executions

#### Scenario: Absent tenantId search attribute produces zero results rather than a cross-tenant leak

- **WHEN** a Temporal visibility query is issued without a `tenantId` search-attribute constraint (for example due to a code path that omits the filter)
- **THEN** the system MUST treat this as a fail-closed condition — returning zero results — consistent with the RLS fail-closed policy defined in this spec for Postgres-backed tables

### Requirement: Workflow IDs whose tenant prefix does not match the caller are treated as non-existent

The system SHALL intercept any describe, history, signal, cancel, or retry request whose workflow ID prefix (the `tenantId` component of `{tenantId}:{workspaceId}:{flowId}:{runUuid}`) does not equal the caller's authenticated `tenantId`, and MUST return HTTP 404 without forwarding the request to Temporal, so that the existence of another tenant's workflow is never disclosed.

#### Scenario: Mis-prefixed workflow ID is intercepted before reaching Temporal

- **WHEN** tenant A's authenticated session submits a describe-execution request with a workflow ID whose prefix is `tenantB:`
- **THEN** the system MUST return HTTP 404 and MUST NOT issue any Temporal RPC call, so that Temporal's own error messages (which might confirm or deny existence) are never exposed to tenant A
