# Tasks — add-enduser-lifecycle-management

## Reproduce (test-first)
- [x] Failing black-box test: `tests/blackbox/enduser-lifecycle-management.test.mjs` (bbx-567-01..05). RED before (no `iamDeleteUser`/`iamSetUserStatus` handlers; routes were NO_ROUTE). Drives the handlers with a stub pool + injected `kcAdmin`: owner delete/disable happy paths, cross-tenant 403, superadmin, and status-body validation 400.

## Implement (kind runtime AND shippable product)
- [x] Implement the disable/delete (and status) end-user routes, authorizing superadmin OR the owner/admin of the tenant that OWNS the realm (never cross-tenant):
  - `deploy/kind/control-plane/routes.mjs` — `DELETE /v1/iam/realms/{realmId}/users/{userId}` → `iamDeleteUser`; `PATCH /v1/iam/realms/{realmId}/users/{userId}/status` → `iamSetUserStatus` (paths match `public-route-catalog.json`).
  - `deploy/kind/control-plane/b-handlers.mjs` — `iamDeleteUser` + `iamSetUserStatus` + `authorizeRealmManage(ctx)` (superadmin/internal → any; else resolve realm→tenant and require `canManageTenant`). Exported in `LOCAL_HANDLERS`.
  - `deploy/kind/control-plane/kc-admin.mjs` — added `setUserEnabled(realm,userId,enabled)` (PUT) + `getUser`; `deleteUser` already existed.
  - `deploy/kind/control-plane/tenant-store.mjs` — added `getTenantByRealm(pool, realm)`.
- [x] DUAL-LOCUS determination: the shippable executor (`apps/control-plane/src/runtime/server.mjs`) serves only the data plane and PROXIES iam/realm routes to the kind control-plane (`CONTROL_PLANE_UPSTREAM`), so the kind `b-handlers` is the operative runtime for this surface; no separate product iam route exists to wire. (`apps/control-plane/src/iam-governance.mjs` is unrelated plan/governance logic.)

## Verify
- [x] `node --test tests/blackbox/enduser-lifecycle-management.test.mjs` → 5/5 green; `node --check` on edited modules OK. (Full suite + CI quality subset in the batch barrier.)
- [ ] Acceptance (live): owner disables then deletes an app end-user; the user can no longer authenticate (ROPC → "Account disabled" / user gone) — folded into the consolidated live RED→GREEN verification on kind.

## Archive
- [ ] `openspec validate add-enduser-lifecycle-management --strict`; archive in the batch (after the combined commit closing the issue).
