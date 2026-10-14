# Console self-tenant context

The console distinguishes a selected tenant from the caller's own tenant context. Self-tenant routes
under `/v1/tenant/*` are only valid when the authenticated principal has an own tenant in its session
or token. Tenant-less platform principals (`superadmin`, `platform_admin`, `platform_operator` with no
`tenantIds`) must not use those routes just because a tenant is selected in the shell.

Capability gates use the selected tenant explicitly:

- with `activeTenantId`, the shell calls `GET /v1/tenants/{tenantId}/effective-capabilities`;
- without `activeTenantId`, the shell settles capabilities to `{}` and gate hooks fail closed;
- it never probes `GET /v1/tenant/effective-capabilities` for a tenant-less platform principal.

`/console/my-plan` remains an own-tenant view for tenant users. For tenant-less platform principals it
shows `No personal tenant plan` and does not call
`GET /v1/tenant/plan/effective-entitlements`. `/console/my-plan/allocation` follows the same rule and
does not call `GET /v1/tenant/plan/allocation-summary` for tenant-less platform principals. The
tenant-specific plan page `/console/tenants/{tenantId}/plan` is a superadmin-only route; non-superadmin
platform roles see the no-personal-plan state without a tenant-plan action.

`GET /v1/tenant/plan/history` reads plan assignment history for the token tenant only. The action
accepts actors with an id, a token tenant (`actor.tenantId` or `actor.tenant.id`), and type
`tenant_owner`, `tenant-owner`, or `tenant`. At the HTTP `tenant_owner` gate, `tenant_owner` works
directly; the realm role `tenant_admin` also maps to this type. Explicit `tenant-owner` and `tenant`
types must additionally carry realm role `tenant_owner` or `tenant_admin` to pass that gate.

The action returns `403 FORBIDDEN` for `superadmin`, `internal`, `tenant_member`, `workspace_admin`,
other actor types, missing actor ids, and missing token tenants, even when a query `tenantId` is
supplied. Query `tenantId` may only equal the token tenant; a mismatch is rejected before database
access. Request parameters never select the tenant. Missing bearer tokens are rejected, and the
gateway route `self-tenant-plan-history` enables `keycloak-openid-connect`.

The response is `{tenantId, assignments, total, page, pageSize}`. Assignments are ordered by
`effectiveFrom` descending and contain exactly `assignmentId`, `planId`, `planSlug`,
`planDisplayName`, `planStatus`, `effectiveFrom`, and `supersededAt` (null for the current assignment).
Operator identities, metadata, descriptions, capabilities, quotas, and per-item tenant ids are
omitted. Empty histories return `assignments: []` and `total: 0`. Pagination defaults to page 1 and
page size 20; values must be positive integers (query strings match `^[1-9][0-9]*$`), with page size
at most 100. Invalid pagination returns `400 VALIDATION_ERROR`.

The console service `getMyPlanHistory({page, pageSize})` normalizes `assignments` to `items`. The
tenant-id scoped `GET /v1/tenants/{tenantId}/plan/history` remains superadmin-only. The Mi plan UI
continues to show its current empty-history state until the dependent timeline task consumes the
self-history service.
