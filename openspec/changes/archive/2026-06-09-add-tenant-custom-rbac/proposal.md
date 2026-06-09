## Why

Authorization in Falcone is governed by a fixed, platform-defined permission matrix
(`services/internal-contracts/src/authorization-model.json::permission_matrix`, line 716+)
that enumerates static roles (`platform_admin`, `platform_operator`, `tenant_owner`,
`tenant_admin`, etc.) with hard-coded `allowed_actions`/`denied_actions`. Tenants
cannot define their own roles.

`services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (line 23) lists 14
platform/tenant/workspace role names that are actively blocked from mutation when
`context.scope !== 'platform'` (line 412). While `effective_roles` flow through the
gateway via `X-Actor-Roles` and `tenant.effective_permissions.read/recalculate` actions
exist in the matrix, there is no API surface to *author* a tenant-scoped role that
bundles a subset of permission_matrix actions. Tenant admins are therefore constrained
to coarse, platform-defined role grants with no internal least-privilege control.

## What Changes

- Introduce a per-tenant custom role catalog stored as `(tenant_id, workspace_id, role_name, allowed_actions[])` — role names are namespaced with a `custom:` prefix to guarantee no collision with `RESERVED_ROLE_NAMES`.
- Expose CRUD endpoints `GET/POST/PUT/DELETE /v1/iam/tenant-roles/*` in the IAM family (prefix `/v1/iam`), gated on `tenant.role_mappings.manage` (already in `tenant_owner`/`tenant_admin` `allowed_actions`).
- Validate that a custom role's `allowed_actions` is a strict subset of the actions reachable by the requesting principal's own permissions — a custom role can never grant more than the creator holds, and can never grant any platform-scoped / cross-tenant action.
- Persist active custom-role `allowed_actions` and expose them so the effective-permissions resolver / token issuance can fold custom bindings in (the end-to-end runtime enforcement at the gateway is infra-bound and delivered separately — **deferred** in this change; see tasks.md scope note).
- Reuse the existing `tenant.effective_permissions.recalculate` action to trigger recalculation when a custom role is mutated or deleted.
- Persist role→permission bindings via a new migration on the provisioning-orchestrator (tenant/DB) migration set.

## Capabilities

### New Capabilities

- `tenant-rbac`: Per-tenant custom role catalog; tenant admins define namespaced roles binding a subset of permission_matrix actions, scoped to `(tenant_id, workspace_id)`, folded into the existing effective-permissions resolution.

### Modified Capabilities

## Impact

- `services/internal-contracts/src/authorization-model.json::permission_matrix` — read as the allowed-action universe; custom roles validated against it; no structural change to the matrix itself.
- `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (line 23) — custom role names validated against this list at creation time (must not match; `custom:` prefix enforces this).
- `services/adapters/src/keycloak-admin.mjs` (line 412) — existing guard reused; new custom-role path bypasses Keycloak realm-role mutation and persists bindings in the control-plane DB instead.
- New migration: `services/provisioning-orchestrator/src/migrations/120-tenant-custom-roles.sql` — `tenant_custom_roles` table with `(tenant_id, workspace_id, role_name, allowed_actions[], created_by, created_at, updated_at, deleted_at)`. (Reconciled: there is no `apps/control-plane/src/migrations/` dir; tenant/DB migrations live under provisioning-orchestrator, latest 118; 119 reserved by add-usage-billing-export → next is 120.)
- New module `apps/control-plane/src/iam-tenant-roles.mjs` with the CRUD handlers, registered alongside the existing IAM admin surface; 5 operations added to the unified OpenAPI source with the route catalog + IAM family doc regenerated.
- `services/gateway-config/base/public-api-routing.yaml` — no new family needed: `/v1/iam/tenant-roles*` falls under the existing `iam` family, which already declares `planCapabilityAnyOf: [identity.sso.oidc]` and the `tenant_control` validation profile (`rejectSpoofedContextHeaders: true`). (Reconciled: gateway policy is modelled per-family by path prefix; a separate `tenant_iam_custom_roles` family sharing the `/v1/iam` prefix would conflict.)
