## Scope note (management + validation; enforcement deferred)

This change delivers the **management surface + validation** half of tenant custom
RBAC. The runtime **enforcement** half is infra-bound and is **DEFERRED**: in this
codebase, effective permissions are carried in the Keycloak-issued JWT (`effective_roles`)
and the gateway `scope-enforcement.lua` does NOT read custom-role `allowed_actions`
from a DB at request time; there is no in-source runtime effective-permissions
resolver to extend. Therefore an end-to-end "user assigned a custom role passes/denies
a gateway scope check" and the resolver-merge require Keycloak token issuance + the
gateway (E2E/infra), which is out of scope here. Mutations DO emit the existing
`tenant.effective_permissions.recalculate` trigger and persist `allowed_actions` so the
(separately delivered) resolver / token-issuance half can fold custom roles in.

Deferred tasks: **2.7, 2.8, 5.1, 5.2, 5.3** (and 6.x, which the existing IAM gateway
family already covers — see note under section 6).

## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [x] 1.2 Confirm `openspec validate add-tenant-custom-rbac --strict` passes

## 2. Black-box tests (write first)

- [x] 2.1 Black-box tests drive handlers via a fake `db` + gateway-trusted identity
  headers (no external test-tenant provisioning needed for the management surface);
  Tenant A/B isolation is exercised through seeded rows in the fake DB
- [x] 2.2 Write black-box test: tenant admin creates a valid `custom:` prefixed role with a subset of their own permissions — expects HTTP 201 and persisted record (`bbx-tcr-create-valid`)
- [x] 2.3 Write black-box test: role name without `custom:` prefix is rejected with HTTP 422 (`bbx-tcr-no-prefix`)
- [x] 2.4 Write black-box test: role name matching a RESERVED_ROLE_NAMES entry is rejected with HTTP 422 (`bbx-tcr-reserved-name`)
- [x] 2.5 Write black-box test: `allowed_actions` containing a platform-scoped action (`tenant.suspend`) is rejected with HTTP 403 (`bbx-tcr-platform-action`); also `app.admin` → 403 regardless of role (`bbx-tcr-platform-app-admin`)
- [x] 2.6 Write black-box test: `allowed_actions` containing an action the creator does not hold is rejected with HTTP 403 (`bbx-tcr-not-held-action`)
- [ ] 2.7 ~~user assigned the custom role passes scope check on a protected endpoint~~ — **DEFERRED (infra-bound enforcement)**: requires Keycloak token issuance + gateway scope-enforcement; no in-source runtime resolver to drive black-box. Persistence + recalculate trigger are covered instead.
- [ ] 2.8 ~~after custom role deletion, scope check on the same endpoint is denied~~ — **DEFERRED (infra-bound enforcement)**: same rationale as 2.7. Soft-delete + recalculate trigger are implemented and exposed for the resolver.
- [x] 2.9 Write black-box test: Tenant A actor cannot read `GET /v1/iam/tenant-roles/{roleId}` belonging to Tenant B — expects HTTP 404 (`bbx-tcr-cross-tenant-get`); plus list-scoping test (`bbx-tcr-list-scoped`)
- [x] 2.10 Confirm all new tests fail before implementation (red-green discipline) — confirmed RED (ERR_MODULE_NOT_FOUND) before implementing

## 3. Database migration

- [x] 3.1 Write migration `services/provisioning-orchestrator/src/migrations/120-tenant-custom-roles.sql` creating `tenant_custom_roles` table with `(tenant_id, workspace_id, role_name, allowed_actions[], created_by, created_at, updated_at, deleted_at)` — **path reconciled**: there is no `apps/control-plane/src/migrations/` dir; tenant/DB migrations live under provisioning-orchestrator; latest 118; 119 is taken by add-usage-billing-export → 120
- [x] 3.2 Add index `(tenant_id, workspace_id)` (active rows) and unique constraint `(tenant_id, workspace_id, role_name)` WHERE `deleted_at IS NULL`
- [x] 3.3 Add DB check constraint `role_name LIKE 'custom:%'`

## 4. API route handlers

- [x] 4.1 Implement `POST /v1/iam/tenant-roles` with validation: `custom:` prefix (422), reserved name check (422), platform-scoped action guard (403), actions subset / not-held check (403) — `apps/control-plane/src/iam-tenant-roles.mjs::createTenantCustomRole` — **path reconciled**: IAM family prefix is `/v1/iam` (not `/v1/admin/iam`); `/v1/admin/iam/...` would fail `validate:public-api` prefix alignment
- [x] 4.2 Implement `GET /v1/iam/tenant-roles` listing roles scoped to caller's `(tenant_id, workspace_id)` — `listTenantCustomRoles`
- [x] 4.3 Implement `GET /v1/iam/tenant-roles/{roleId}` returning 404 if role belongs to a different tenant (no existence leak) — `getTenantCustomRole`
- [x] 4.4 Implement `PUT /v1/iam/tenant-roles/{roleId}` with same validation as POST; trigger recalculate on success — `updateTenantCustomRole`
- [x] 4.5 Implement `DELETE /v1/iam/tenant-roles/{roleId}` (soft delete via `deleted_at`); trigger `tenant.effective_permissions.recalculate` — `deleteTenantCustomRole`
- [x] 4.6 Add the 5 operations to the unified OpenAPI source and **regenerate** the route catalog + IAM family doc (`npm run generate:public-api`); `npm run validate:public-api` passes; the `tests/unit/public-api.test.mjs` byte/deepEqual catalog assertion passes

## 5. Effective-permissions resolver

- [ ] 5.1 ~~Update the effective-permissions resolver to query `tenant_custom_roles` and merge `allowed_actions`~~ — **DEFERRED (infra-bound enforcement)**: no in-source runtime effective-permissions resolver exists to extend; effective permissions are carried in the Keycloak JWT and consumed by the gateway. The persisted `allowed_actions` are the contract surface the resolver / token issuance will read.
- [ ] 5.2 ~~Add short-TTL resolver cache for custom role lookups~~ — **DEFERRED (infra-bound enforcement)**: belongs to the resolver delivered with the gateway/Keycloak half.
- [ ] 5.3 ~~Confirm `tenant.effective_permissions.recalculate` fan-out invalidates the cache on role mutation~~ — **PARTIALLY DEFERRED**: the trigger IS emitted on create/update/delete (`iam-tenant-roles.mjs::triggerRecalculate`, action `tenant.effective_permissions.recalculate`); the downstream cache-invalidation effect is part of the deferred enforcement half.

## 6. Gateway config

- [x] 6.1 Route family for the custom-role routes — **reconciled**: the codebase models gateway policy **per-family by path prefix**, not per-operation. `/v1/iam/tenant-roles*` falls under the existing `iam` family in `services/gateway-config/base/public-api-routing.yaml`, which already declares `planCapabilityAnyOf: [identity.sso.oidc]`. No new `tenant_iam_custom_roles` family is needed (a new family with the same prefix would conflict). Verified via the regenerated catalog (`planCapabilityAnyOf: ["identity.sso.oidc"]`, `tenant_control` profiles, `bearer_oidc`).
- [x] 6.2 Confirm `rejectSpoofedContextHeaders: true` applies — the IAM family uses the `tenant_control` requestValidationProfile which sets `rejectSpoofedContextHeaders: true`; the new routes inherit it.

## 7. Integration validation

- [x] 7.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass (229 pass / 0 fail); plus `pnpm test:unit` (518/517+1 skip incl public-api catalog), `pnpm test:contracts`, `pnpm test:adapters`, `pnpm test:resilience`, `npm run validate:public-api`, `validate:openapi`, `validate:authorization-model`, `validate:gateway-policy` all green
- [x] 7.2 Run `openspec validate add-tenant-custom-rbac --strict`
