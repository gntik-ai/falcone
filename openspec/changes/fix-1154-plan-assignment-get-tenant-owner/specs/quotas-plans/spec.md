# quotas-plans — spec delta for fix-1154-plan-assignment-get-tenant-owner

## ADDED Requirements

### Requirement: Current-plan reads recognize control-plane tenant owners

M7 and M8 SHALL accept actor types `tenant_owner` and `tenant-owner` only for
the caller's own tenant, using one owner-type set for both the allow check and
the tenant equality check. The scoped tenant SHALL equal
`callerContext.tenantId ?? actor.tenantId` before any database read. Superadmin
SHALL retain access to any explicitly scoped tenant.

#### Scenario: Real tenant owner or mapped tenant admin reads its own plan

- **GIVEN** a verified identity with tenantId T and actor type `tenant_owner`,
  including an identity with realm roles only `[tenant_admin]` mapped by the
  control plane to that actor type
- **WHEN** the runtime route table dispatches GET `/v1/tenant/plan` or GET
  `/v1/tenants/T/plan` through real `invokeRoute` to the mapped handler
- **THEN** the result SHALL have statusCode 200 and body.tenantId when
  unassigned, or body.assignment.tenantId when assigned, equal to T
- **AND** the database query SHALL bind tenant T.

#### Scenario: Owner cannot read another tenant

- **GIVEN** actor type `tenant_owner` or `tenant-owner` with verified tenant T,
  including a mapped tenant admin
- **WHEN** M8 requests tenant U, where U differs from T
- **THEN** the handler SHALL reject with code FORBIDDEN and statusCode 403
- **AND** the database SHALL receive zero queries.

#### Scenario: Other actor types remain denied

- **GIVEN** actor type `workspace_admin`, `tenant_member`, `internal`, literal
  `tenant_admin` or literal `tenant`
- **WHEN** the caller requests M7 or own-tenant M8
- **THEN** the handler SHALL reject with FORBIDDEN/403 before any database query.

#### Scenario: Existing authorized and validation behavior is preserved

- **WHEN** a legacy `tenant-owner` requests its own tenant
- **THEN** it SHALL receive 200 scoped to that tenant.
- **WHEN** superadmin requests M8 for any tenant
- **THEN** it SHALL receive 200 scoped to the requested tenant.
- **WHEN** actor.id is missing
- **THEN** the handler SHALL reject with FORBIDDEN/403 before any database query.
- **WHEN** an identified owner has no scoped tenant
- **THEN** the handler SHALL reject with VALIDATION_ERROR/400 before any query.

### Requirement: Runtime route metadata documents the current authorization

The M7/M8 runtime notes SHALL describe own-tenant access for
`tenant_owner`/`tenant-owner` and any-tenant access for superadmin. The JSON
SHALL remain valid, and each route's method, path, module, export, invoke, deps
and auth SHALL remain unchanged.

#### Scenario: Routes still dispatch to the tenant-scoped action

- **WHEN** M7 and M8 are matched in the runtime route table
- **THEN** they SHALL resolve to `plan-assignment-get.mjs`, export `main`,
  invoke `callercontext-overrides`, deps `[db]` and auth `authenticated`
- **AND** M8 SHALL pass the path tenantId as its tenantId parameter.
