## Why

A read-only `tenant_viewer` — and any other non-write role (e.g. `tenant_developer`) — can **create,
update, delete, and publish** flow definitions in their own tenant, **including in the production
workspace**, via the cp-executor:

- `POST   /v1/flows/workspaces/{workspaceId}/flows`                       → `create_definition`
- `PATCH  /v1/flows/workspaces/{workspaceId}/flows/{flowId}`              → `update_definition`
- `DELETE /v1/flows/workspaces/{workspaceId}/flows/{flowId}`              → `delete_definition`
- `POST   /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions`     → `publish_version`

Flow definitions are executable workflow DSL (their activities reach the workspace's data, storage,
functions, and BYOK LLM); a non-admin role being able to author/replace/publish or delete them is a
**within-tenant privilege escalation** (integrity / availability). The web console correctly defers
mutate authority to the server, which makes the gap **silent**: the only enforcement is server-side,
and it is missing for the flows engine.

Root cause: the executor's flow-definition write handlers gate only on tenant/workspace
**membership**, never on **role**. `flow-executor.mjs::executeFlows` calls `requireIdentity(identity)`
(checks only `identity.tenantId` && `identity.workspaceId` presence), then `create_definition` /
`update_definition` / `delete_definition` / `publish_version` go straight to the store. The only `403`
in the file is `CROSS_TENANT_FORBIDDEN` (foreign execution-id ownership on cancel/retry/signal —
unrelated to write-role). The gateway's route catalog already tags the flow-definition writes
`privilege_domain: structural_admin` (`services/gateway-config/public-route-catalog.json`), and the
executor already enforces an equivalent write-capable admin role set for API-key management
(`server.mjs::KEY_MGMT_ADMIN_ROLES`, #624) — but the flows engine never applied it. Confirmed on
`main` (HEAD `249f7bf7`): the same `tenant_viewer` is correctly `403` on every kind-control-plane
write, and cross-tenant isolation holds; only the within-tenant flow-definition write is open
(issue #760).

## What Changes

- Role-gate the four flow-DEFINITION write operations (`create_definition`, `update_definition`,
  `delete_definition`, `publish_version`) in `apps/control-plane/src/runtime/flow-executor.mjs::
  executeFlows`, AFTER `requireIdentity(identity)` and BEFORE any store read/write side effect. A
  caller whose verified roles are KNOWN (a non-empty array) and contain NO write-capable admin role
  is rejected with **`403 FORBIDDEN`** and the store is **never touched** (nothing
  created/updated/deleted/published).
- Extract the write-capable admin role set into a small shared module
  `apps/control-plane/src/runtime/auth-roles.mjs` (`WRITE_CAPABLE_ADMIN_ROLES` =
  `{tenant_owner, tenant_admin, workspace_owner, workspace_admin, platform_admin, superadmin}`) and
  import it from BOTH `server.mjs` (the existing `KEY_MGMT_ADMIN_ROLES` is now an alias of it —
  byte-identical behavior for `/api-keys`) and `flow-executor.mjs` — a single source of truth the two
  gates cannot drift apart on. `auth-roles.mjs` imports nothing from the runtime, so there is **no
  import cycle** (server.mjs gains no transitive dependency on flow-executor.mjs).
- The gate uses the SAME defer-on-unknown semantics as the #624 API-key gate: it denies ONLY when the
  roles are a known, non-empty list lacking a write-capable role; an undefined/empty roles list
  DEFERS (a legitimate admin token carrying no realm-role claims, the trusted-gateway path, the no-DB
  black-box mode) — so internal/system/no-claims callers are never regressed. On the kind path the
  gateway forwards the Bearer JWT (and strips `x-actor-roles`), so the executor verifies the token
  itself and a `tenant_viewer` arrives as `roles:['tenant_viewer']` (a known, non-write list) → denied.
- **Execution lifecycle is unchanged**: start / cancel / retry / signal a run, and get/list executions
  and all reads, are NOT role-gated here (they are `data_access`; cancel/retry already enforce
  cross-tenant run ownership). `validate` (POST .../validate) is a read-only check (no store mutation)
  and is likewise not a write — it is not gated by this change.
- **Cross-tenant ordering preserved**: cross-tenant is denied at the `server.mjs` dispatch
  (`CROSS_TENANT_VIOLATION`) BEFORE `executeFlows`, so this gate fires only for within-tenant callers
  and never weakens or reorders the cross-tenant path. Store calls remain scoped by the caller's
  verified `identity.tenantId` / `identity.workspaceId`.
- **No API surface / contract change**: the route catalog already declares these writes
  `structural_admin`, `403` is a standard authz outcome, and the flow writes are executor routes (not
  in the public OpenAPI idempotency-gated set), so no `*.openapi.json`, generated SDK/types, route
  catalog, or Idempotency-Key change is required; `generate:public-api` produces no diff.
- **Frontend**: the console already routes flow create/update/publish through `flowsApi.ts` and
  surfaces a rejected write as an error banner (`ConsoleFlowsPage` `createError`,
  `ConsoleFlowDesignerPage` `applyServerRejection` → `loadError`) without crashing or unhandled
  rejections, so the new `403` degrades gracefully — **no frontend change**. (Proactively
  hiding/disabling "New flow" for non-write roles is the separate enhancement #761, out of scope.)
- **Docs**: `docs/reference/architecture/flow-schedule-management.md` gains a "Role authorization on
  flow-definition writes" section documenting the role gate, the production parity, that
  `tenant_viewer` / non-write roles are denied `403`, and that execution/read operations and
  `validate` are not write-gated.

## Design note — why the coarse write-capable admin role set (deliberate scope)

The route catalog declares the flow-definition writes under `privilege_domain: structural_admin`, but
that domain is **declarative only** — the gateway's `scope-enforcement.lua` is a `nil` stub (declared,
unenforced) and the executor is the sole auth authority on the flows route. We reuse the existing
write-capable admin role set (`KEY_MGMT_ADMIN_ROLES`, #624) for **consistency with the executor's only
other role gate and minimal regression**; it fully satisfies #760's acceptance criteria (deny
`tenant_viewer` / `tenant_developer`; allow owner/admin/workspace_admin/superadmin/platform_admin).
A finer per-workspace-role audience model across the whole surface is a **pre-existing broader gap**
(tracked by #761 / #773) and is explicitly **out of scope** for this fix; gating any non-write role
here also closes the flows slice of #773 as a correct consequence of the role model.

## Design note — the gate's safety relative to cross-tenant isolation

The new gate is a within-tenant authorization check only. Cross-tenant access is already denied
upstream at the `server.mjs` dispatch (`CROSS_TENANT_VIOLATION`, resolving the workspace's owning
tenant against the caller's verified tenant) BEFORE `executeFlows` runs, and the store calls in the
write handlers are scoped by the caller's verified `identity.tenantId` / `identity.workspaceId`
(realm-bound, never body/claim-controlled). Therefore this change neither weakens nor reorders the
cross-tenant path: a tenant-A token can only ever address tenant A's workspaces, and within tenant A
it must now also carry a write-capable role to mutate a flow definition.

## Capabilities

### Modified Capabilities

- `workflows`: an ADDED requirement — flow-definition create / update / delete / publish are authorized
  by the verified caller's **role** (a write-capable tenant/workspace admin role), not tenant/workspace
  membership alone; a read-only `tenant_viewer` (and any other non-write role) is denied with `403` and
  persists/deletes/publishes nothing, on every workspace and stage (including production), while
  write-capable roles remain authorized and the execution/read surface is unchanged. This is a distinct
  authorization concern from the existing `workflows` requirements (Temporal infra, the durable
  interpreter, schedule management), so it is added as a NEW requirement rather than a MODIFIED one
  (cleaner and avoids the archive-sync MODIFIED-block hazard; mirrors sibling fix-798).

## Impact

- `apps/control-plane/src/runtime/auth-roles.mjs` — NEW shared module: `WRITE_CAPABLE_ADMIN_ROLES` +
  `hasWriteCapableRole` / `isKnownNonWriteRole`. Imports nothing from the runtime (no cycle).
- `apps/control-plane/src/runtime/flow-executor.mjs` — import `isKnownNonWriteRole`; add
  `DEFINITION_WRITE_OPERATIONS` + `requireDefinitionWriteRole(identity)`; call it in `executeFlows`
  for the four write ops, before any store side effect. Execution/read ops unchanged.
- `apps/control-plane/src/runtime/server.mjs` — import `WRITE_CAPABLE_ADMIN_ROLES`; `KEY_MGMT_ADMIN_ROLES`
  is now an alias of it (the API-key gate at the requestGate role check is byte-identical).
- `tests/unit/flow-write-role-gate.test.mjs` — NEW `node:test` regression slice (CI runs
  `pnpm test:unit`): viewer & developer denied `403` on each write with the recording fake store never
  mutated; owner / workspace_admin / superadmin authorized with the store call carrying the caller's
  tenant/workspace; RED on `main`, GREEN on the branch.
- `docs/reference/architecture/flow-schedule-management.md` — new "Role authorization on flow-definition
  writes" section.
- No change to any `*.openapi.json`, generated SDK/types, or `public-route-catalog.json`.
