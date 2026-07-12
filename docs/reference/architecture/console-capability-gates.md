# Console capability gates — catalog keys and the Flows exception

The web console hides or dims plan-restricted features behind `CapabilityGate`
(`apps/web-console/src/components/console/CapabilityGate.tsx`), which reads the per-tenant effective
capabilities through `useCapabilityGate` (`apps/web-console/src/lib/hooks/use-capability-gate.ts`).
This page documents the **one invariant** that governs every gate and the **Flows exception**.

## The fail-closed invariant

`useCapabilityGate(key)` returns `enabled: true` **only** when `capabilities[key] === true`. For any
other value — including an **absent** key — it returns `{ enabled: false, reason: 'plan_restriction' }`
(fail-closed). In `mode="disable"` (the default) a disabled gate wraps its children in
`<div class="opacity-50 pointer-events-none" data-testid="capability-gate-disabled">` plus an upgrade
badge, so the surface is visible but inert.

The `capabilities` map comes from the effective-capabilities action
(`packages/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs`). When the
console has an active tenant context, it calls `GET /v1/tenants/{tenantId}/effective-capabilities`
with that tenant id. It does **not** call the self-tenant route
`GET /v1/tenant/effective-capabilities` for tenant-less platform principals such as `superadmin`;
with no active tenant, the capability map is settled to `{}` and gates fail closed without a
background self-tenant probe. That handler builds the map by iterating **only** over the active rows
of the boolean-capability catalog. A key that is not in the catalog is therefore **never present** in
the response — it is structurally `undefined`, not `false`.

**Consequence:** gating a feature on a key that is not in the catalog makes the gate **impossible to
satisfy** for any tenant on any plan. The surface is permanently dimmed everywhere. This is always a
bug, never a configuration choice.

## The catalog is the source of truth

The boolean-capability catalog (`boolean_capability_catalog.capability_key`) is seeded by exactly two
provisioning-orchestrator migrations:

| Migration | Keys |
| --- | --- |
| `104-plan-boolean-capabilities.sql` | `sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions` |
| `114-backup-scope-deployment-profiles.sql` | `backup_scope_access` |

The console mirrors this set in one place — `apps/web-console/src/lib/capabilities/catalog-keys.ts`
(`BOOLEAN_CAPABILITY_KEYS` + the `BooleanCapabilityKey` union). The `CapabilityGate` `capability` prop
and the `useCapabilityGate` key are typed to that union, so a phantom key fails to compile. An audit
test (`apps/web-console/src/lib/capabilities/capability-gate-keys.test.ts`) additionally scans the
source for every gate usage and fails if any key is outside the catalog — it catches phantom keys even
when introduced through an `as`-cast.

**When you add a console gate:** add the capability key to a provisioning-orchestrator catalog
migration first, then add it to `BOOLEAN_CAPABILITY_KEYS`, then reference it from the page.

## Flows is not plan-gated

The Flows feature (visual designer, run history, run view, flow designer) is **not** gated on any
boolean capability and **must not** be wrapped in `CapabilityGate`. There is no `workflows` key in the
catalog, and the flow control-plane API is open to every tenant regardless of plan — there is no
`/v1/flows/...` entry in the gateway capability-gated route map
(`deploy/gateway-config/routes/capability-gated-routes.yaml`) and no flows `planCapabilityAnyOf`
block in `deploy/gateway-config/base/public-api-routing.yaml`. The four Flows pages
(`apps/web-console/src/pages/ConsoleFlows*Page.tsx`) render their content directly. (#790)

The Functions **publish wizard** (`apps/web-console/src/pages/ConsoleFunctionsPage.tsx`) is genuinely
plan-gated and keeps its gate, on the real catalog key `public_functions` (Public Serverless
Functions).
