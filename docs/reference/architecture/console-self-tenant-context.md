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
`GET /v1/tenant/plan/effective-entitlements`. Platform admins review or change a tenant's plan from
`/console/tenants/{tenantId}/plan`.
