# Console create-tenant plan assignment

The create-tenant wizard is the console entry point for provisioning a new tenant and attaching its
initial commercial plan. The Plan step is intentionally catalog-backed: it loads active plans through
`listPlans({ status: 'active', page: 1, pageSize: 100 })`, which calls `GET /v1/plans` through the
authenticated console session client.

The wizard must render only plans returned by that active catalog query. Each `<option>` displays the
plan's `displayName` and `slug`, but its value is the catalog plan `id`. The submitted tenant create
payload remains:

```json
{
  "name": "Acme",
  "planId": "<catalog-plan-id>",
  "region": "eu-west",
  "preferences": {
    "locale": "en"
  }
}
```

The control-plane route `POST /v1/tenants` is the source of truth for tenant creation. In the kind
control-plane implementation, `deploy/kind/control-plane/b-handlers.mjs` passes `body.planId` into
`assignPlanBestEffort` after the tenant record is inserted. That path resolves and assigns the plan
using the existing plan-management assignment action; the assignment is observable through
`GET /v1/tenants/{tenantId}/plan`.

Because creation-time assignment is supported by the backend, the console must not invent fallback
plans such as hardcoded Starter/Growth options. If the active catalog is loading, unavailable, or
empty, the wizard keeps the Plan step in place with an accessible status/error/empty message and
does not allow the operator to continue until a real active plan is selectable.

No wire contract changed for this behavior. The frontend still calls `GET /v1/plans` and
`POST /v1/tenants`, and the tenant create body still uses `planId`; the fix is that `planId` now comes
from a real catalog record ID instead of a synthetic UI value.

Once the wizard succeeds, its summary step renders an "Abrir recurso" link — a link to follow,
not an automatic redirect — to the created tenant, and the tenant becomes visible in the
`/console/tenants` inventory. That link's destination is role-aware: a `superadmin` creator gets
a link straight to the new tenant's plan page (`/console/tenants/{tenantId}/plan`, which is
`RequireSuperadminRoute`-gated); any other role allowed to create a tenant (e.g.
`platform_operator`) gets a link to the `/console/tenants` inventory instead, where the new
tenant already appears — see
[console-tenant-inventory.md](./console-tenant-inventory.md) for the full role breakdown.
