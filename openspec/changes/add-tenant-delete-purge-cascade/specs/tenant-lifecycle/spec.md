## ADDED Requirements

### Requirement: Tenant deletion and purge MUST be available

The system SHALL expose `DELETE /v1/tenants/{t}` and `POST /v1/tenants/{t}/purge` so an operator can offboard a tenant, rather than returning `404 NO_ROUTE`.

#### Scenario: Purge route is reachable

- **WHEN** an authorized operator calls `POST /v1/tenants/{t}/purge` for an existing tenant
- **THEN** the system accepts the request and begins removing the tenant (not `404 NO_ROUTE`)

### Requirement: Tenant purge MUST cascade to all owned resources

The system SHALL, on tenant purge, remove every resource the tenant owns — workspaces, databases, realms, buckets, topics, keys, registry rows, and async-op rows — leaving no orphaned data.

#### Scenario: No orphans remain after purge

- **WHEN** a tenant with a workspace, database, realm, bucket, and topic is purged
- **THEN** none of those resources and no `workspace_databases`/`async_operations` rows for that tenant remain
