## 1. Baseline

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-tenant-custom-rbac --strict` passes

## 2. Black-box tests (write first)

- [ ] 2.1 Add fixture that provisions two test tenants (A and B) with tenant_admin actors via the public API
- [ ] 2.2 Write black-box test: tenant admin creates a valid `custom:` prefixed role with a subset of their own permissions — expects HTTP 201 and persisted record
- [ ] 2.3 Write black-box test: role name without `custom:` prefix is rejected with HTTP 422
- [ ] 2.4 Write black-box test: role name matching a RESERVED_ROLE_NAMES entry is rejected with HTTP 422
- [ ] 2.5 Write black-box test: `allowed_actions` containing a platform-scoped action (`tenant.suspend`) is rejected with HTTP 403
- [ ] 2.6 Write black-box test: `allowed_actions` containing an action the creator does not hold is rejected with HTTP 403
- [ ] 2.7 Write black-box test: user assigned the custom role passes scope check on a protected endpoint
- [ ] 2.8 Write black-box test: after custom role deletion, scope check on the same endpoint is denied
- [ ] 2.9 Write black-box test: Tenant A actor cannot read `GET /v1/admin/iam/tenant-roles/{roleId}` belonging to Tenant B — expects HTTP 404
- [ ] 2.10 Confirm all new tests fail before implementation (red-green discipline)

## 3. Database migration

- [ ] 3.1 Write migration `apps/control-plane/src/migrations/NNN-tenant-custom-roles.sql` creating `tenant_custom_roles` table with `(tenant_id, workspace_id, role_name, allowed_actions[], created_by, created_at, updated_at, deleted_at)`
- [ ] 3.2 Add index `(tenant_id, workspace_id)` and unique constraint `(tenant_id, workspace_id, role_name)` WHERE `deleted_at IS NULL`
- [ ] 3.3 Add DB check constraint `role_name LIKE 'custom:%'`

## 4. API route handlers

- [ ] 4.1 Implement `POST /v1/admin/iam/tenant-roles` with validation: `custom:` prefix, reserved name check, actions subset check, cross-tenant action guard
- [ ] 4.2 Implement `GET /v1/admin/iam/tenant-roles` listing roles scoped to caller's `(tenant_id, workspace_id)`
- [ ] 4.3 Implement `GET /v1/admin/iam/tenant-roles/{roleId}` returning 404 if role belongs to a different tenant
- [ ] 4.4 Implement `PUT /v1/admin/iam/tenant-roles/{roleId}` with same validation as POST; trigger recalculate on success
- [ ] 4.5 Implement `DELETE /v1/admin/iam/tenant-roles/{roleId}` (soft delete via `deleted_at`); trigger `tenant.effective_permissions.recalculate`

## 5. Effective-permissions resolver

- [ ] 5.1 Update the effective-permissions resolver to query `tenant_custom_roles` for `(tenant_id, workspace_id)` and merge `allowed_actions` into the resolved permission set
- [ ] 5.2 Add short-TTL resolver cache (mirror `planCacheTtlSeconds`) for custom role lookups
- [ ] 5.3 Confirm `tenant.effective_permissions.recalculate` fan-out invalidates the cache on role mutation

## 6. Gateway config

- [ ] 6.1 Add route family `tenant_iam_custom_roles` to `services/gateway-config/base/public-api-routing.yaml` under the IAM group with `planCapabilityAnyOf: [identity.sso.oidc]`
- [ ] 6.2 Confirm `rejectSpoofedContextHeaders: true` applies to the new route family

## 7. Integration validation

- [ ] 7.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] 7.2 Run `openspec validate add-tenant-custom-rbac --strict`
