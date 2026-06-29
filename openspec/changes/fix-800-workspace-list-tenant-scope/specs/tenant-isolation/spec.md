# tenant-isolation — spec delta for fix-800-workspace-list-tenant-scope

## ADDED Requirements

### Requirement: Workspace listing is tenant-scoped and fail-closed

The system SHALL scope `GET /v1/workspaces` to the caller's authenticated tenant for every
non-superadmin/non-internal principal, and SHALL return no workspaces (an empty collection,
fail-closed) when the principal's verified identity has no resolvable tenant — never another
tenant's workspace rows. The store query underlying the listing SHALL NOT drop the
`WHERE tenant_id = …` predicate when the tenant is null; instead it SHALL require an
explicit `allTenants` opt-in for the unscoped (superadmin/internal "list all") path so that
a missing scope can never silently produce a cross-tenant disclosure.

The system SHALL ensure that the list and by-id workspace reads agree: a principal that is
denied (`403`) on `GET /v1/workspaces/{id}` SHALL NOT receive the same workspace through
`GET /v1/workspaces` (i.e., it SHALL NOT appear in the listing).

#### Scenario: Non-platform principal with no tenant sees an empty workspace list

- **WHEN** a non-superadmin/non-internal principal whose verified identity has no resolvable
  `tenantId` (e.g., a platform-realm `tenant_viewer` with no `tenant_id` claim) calls
  `GET /v1/workspaces`
- **THEN** the system MUST return HTTP 200 with an empty collection (`items: []`, `total: 0`)
  and MUST NOT include any workspace row belonging to any tenant in the response

#### Scenario: Normal tenant principal sees only its own tenant's workspaces

- **WHEN** a `tenant_owner` or `tenant_admin` whose verified `tenantId` is `ten_A` calls
  `GET /v1/workspaces`
- **THEN** the system MUST return HTTP 200 with only the workspaces whose `tenant_id` equals
  `ten_A`, and MUST NOT include any workspace belonging to any other tenant in the response

#### Scenario: Superadmin/internal sees all workspaces and may filter by tenantId

- **WHEN** a superadmin or internal caller calls `GET /v1/workspaces` with no
  `filter[tenantId]` query parameter
- **THEN** the system MUST return HTTP 200 with all workspaces across all tenants
- **AND WHEN** the same caller supplies `filter[tenantId]=ten_A`
- **THEN** the system MUST return only the workspaces of tenant `ten_A`

#### Scenario: List and by-id reads agree — denied principal sees no workspace in LIST

- **WHEN** a principal that is denied HTTP 403 on `GET /v1/workspaces/{ws_A}` (because it
  does not own workspace `ws_A`) calls `GET /v1/workspaces`
- **THEN** `ws_A` MUST NOT appear in the returned items — the listing and the by-id read
  MUST yield consistent authorization outcomes for the same principal
