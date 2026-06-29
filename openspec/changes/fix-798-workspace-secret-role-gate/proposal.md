## Why

A read-only `tenant_viewer` — and a non-admin `tenant_developer` — can **create, replace, and delete
Workspace Secrets** (#723) in their own tenant, **including in the production workspace**, via the
kind control-plane:

- `POST   /v1/functions/workspaces/{workspaceId}/secrets`        → `secretSet`
- `PUT    /v1/functions/workspaces/{workspaceId}/secrets/{name}` → `secretReplace`
- `DELETE /v1/functions/workspaces/{workspaceId}/secrets/{name}` → `secretDelete`

These secrets are injected into functions as environment values, so a non-admin role can inject an
attacker-chosen value into a production function (integrity / RCE-pivot) or delete a secret and break
prod functions (availability). The web console correctly hides the page from these roles, which makes
the gap **silent**: the only enforcement the frontend relies on does not exist server-side.

Root cause: each handler calls `ownedWorkspace(ctx, workspaceId)`
(`deploy/kind/control-plane/fn-handlers.mjs:60-68`), which only checks `ws.tenant_id === callerTenantId`
(cross-tenant → `null` → `404`) and performs **NO role check**, then writes to the vault store. Every
OTHER privileged write in the control-plane (`b`/`pg`/`mongo`/`webhook`/`metrics` handlers) gates with
`canManageTenant`/`canManageTenantId`; `fn-handlers.mjs` is the only privileged-write module missing
it. Confirmed on `main` (HEAD `cdb13623`) and reproduced on a live kind build (issue #798).

## What Changes

- Gate the three Workspace Secret **write** handlers (`secretSet`, `secretReplace`, `secretDelete`) in
  `deploy/kind/control-plane/fn-handlers.mjs` with the existing reusable `canManageTenant`
  (`deploy/kind/control-plane/tenant-scope.mjs`) — the same coarse tenant-admin gate every other
  privileged control-plane write uses. It admits `{superadmin, internal, tenant_owner, tenant_admin}`
  and denies everyone else, including `tenant_member` (the actorType for `tenant_viewer` and
  `tenant_developer`). A denied caller receives **`403 FORBIDDEN`** and **nothing is
  created/replaced/deleted** (the vault write method is never reached).
- The gate is placed **AFTER** the existing `ownedWorkspace` `404 WORKSPACE_NOT_FOUND` check and
  **BEFORE** any validation/existence-probe/write side effect, so a cross-tenant caller still gets
  `404` (the `404` wins over the `403`, no existence leak) and own-tenant-non-admin is `403` — exactly
  matching the `b-handlers.mjs` pattern (e.g. `updateWorkspace`). The 403 message string matches
  `b-handlers.mjs` for parity (`requires superadmin or tenant owner/admin`).
- **Reads are unchanged**: `secretList` (GET list) and `secretGet` (GET by name) are NOT gated — any
  member of the owning tenant keeps `200` (values remain write-only regardless).
- **No API surface change**: success response shapes are unchanged and `403` is a standard authz
  outcome consistent with every other privileged write, so the OpenAPI contract and generated
  SDK/types are untouched and `generate:public-api` produces no diff.
- **Frontend**: the console already defers to the server (`workspace-secrets-access.ts` is a coarse,
  fail-safe nav/route gate only) — no functional change. One comment-accuracy edit states that
  per-secret mutate authority is now server-enforced by the workspace's tenant role gate
  (`canManageTenant`) in addition to the `ownedWorkspace` tenant/isolation check.
- **Docs**: `docs/reference/architecture/workspace-secrets-console.md` gains a "Role authorization on
  writes" section documenting the role gate, the production parity, the 404-before-403 ordering, and
  that reads are not gated.

## Design note — why the coarse `canManageTenant` gate (deliberate scope)

The route catalog declares `audiences:[workspace_owner, workspace_admin, workspace_developer,
platform_team]` for the secret POST/DELETE routes
(`services/internal-contracts/src/public-route-catalog.json`), but that audience model is
**declarative only** — the gateway enforces no audience, and it is implemented **nowhere** in the
control-plane. Every CP privileged write uses the coarse `canManageTenant` tenant-admin gate (which
also denies `workspace_admin` / `workspace_developer` / `platform_team`). We deliberately reuse
`canManageTenant` here for **consistency with the rest of the CP and minimal regression**; it fully
satisfies #798's acceptance criteria (deny `tenant_developer` / `tenant_viewer`, allow
owner/admin/superadmin). Implementing the finer per-workspace-role audience across the entire CP is a
**pre-existing broader gap** (tracked by #761 / #773) and is explicitly **out of scope** for this fix.

## Capabilities

### Modified Capabilities

- `secrets`: an ADDED requirement — Workspace Secret create/replace/delete are authorized by the
  verified caller's tenant role (`canManageTenant`), not tenant membership alone; non-admin tenant
  members (`tenant_developer` / `tenant_viewer`) are denied with `403` and persist/delete nothing, on
  every workspace and stage (including production). This is a distinct authorization concern from the
  existing `secrets` storage requirement ("Workspace secrets are stored in and consumed from Vault"),
  so it is added as a NEW requirement under `secrets` rather than a MODIFIED one (cleaner and avoids
  the archive-sync MODIFIED-block hazard).

## Design note — the role gate's safety is realm-bound

`canManageTenant` admits an owner/admin only when `identity.tenantId === ws.tenant_id` (and admits
platform/superadmin/internal unconditionally). The verified identity's `tenantId` is derived from the
caller's Keycloak realm (`deriveActorType` may honor an explicit `claims.actor_type`, but the tenant
id is realm-bound, not body/claim-controlled). Therefore even a forged `actor_type` cannot cross
tenants: a tenant-A token can only ever be admitted to manage tenant A's workspaces, so the gate
cannot be turned into cross-tenant write authority. Cross-tenant access remains the `404` path
(`ownedWorkspace`), which fires before this role gate.

## Impact

- `deploy/kind/control-plane/fn-handlers.mjs` — import `canManageTenant`; add the role gate to
  `secretSet`, `secretReplace`, `secretDelete` (after the `404`, before any write). `secretList` /
  `secretGet` / `ownedWorkspace` and all other handlers unchanged.
- `deploy/kind/control-plane/tenant-scope.mjs::canManageTenant` — reused (no change).
- `tests/unit/workspace-secret-role-gate.test.mjs` — new `node:test` regression slice (CI runs
  `pnpm test:unit`).
- `apps/web-console/src/lib/workspace-secrets-access.ts` — comment-only accuracy edit (no logic).
- `docs/reference/architecture/workspace-secrets-console.md` — new "Role authorization on writes"
  section.
- `openspec/changes/fix-798-workspace-secret-role-gate/specs/secrets/spec.md` — the spec delta
  (`## ADDED Requirements`) under the `secrets` capability.
- No change to any `*.openapi.json`, generated SDK/types, or the public route catalog.
