# Tasks — add-tenant-owner-enduser-management

## Reproduce (test-first)
- [x] `tests/blackbox/tenant-owner-enduser-list.test.mjs` — fails on old code: `iamListUsers` had no owner authz and the route was superadmin-only (owner → 403).

## Implement (kind runtime AND shippable product as applicable)
- [x] `b-handlers.mjs::iamListUsers`: authorize via `authorizeRealmManage` (superadmin OR owning-tenant owner/admin; cross-tenant denied) and accept an injectable `ctx.kcAdmin`.
- [x] `routes.mjs`: `GET /v1/iam/realms/{realmId}/users` → `auth: 'authenticated'` (handler authorizes), matching the #567 delete/status routes.

## Verify
- [x] `node --test tests/blackbox/tenant-owner-enduser-list.test.mjs` green; enduser-lifecycle / iam-realm-binding / iam-user-credentials unaffected.
- [x] Acceptance: an owner lists (and per #567 disables/deletes) only its own project's end-users; cross-tenant denied (no Keycloak call).

## Archive
- [ ] `openspec validate add-tenant-owner-enduser-management --strict`; `/opsx:archive add-tenant-owner-enduser-management` after merge.
