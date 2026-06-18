# Tasks — fix-console-operator-tenant-context

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: logged in as `acme-ops` (tenant_owner), the console loads no tenant context; My-plan/Members 403.
  - Added `tests/blackbox/console-operator-tenant-context.test.mjs` (7 bbx scenarios; bbx-coctx-01..07)
  - Added 3 vitest scenarios in `apps/web-console/src/lib/console-context.test.tsx` (operator role-branch)
  - Confirmed: all new tests FAILED before implementation (routes missing, console called superadmin endpoint)

## Implement (kind runtime AND shippable product)
- [x] Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz — `apps/web-console` + the control-plane plan routes.
  - `apps/web-console/src/lib/console-context.tsx`: added `isSuperadmin` memo from `platformRoles`; refactored `listAccessibleTenants()` to accept `{isSuperadmin, ownTenantIds}` — operators now call `GET /v1/tenants/{id}` per owned tenant instead of the superadmin collection; non-superadmin with empty tenantIds returns empty list (fail-safe)
  - `deploy/kind/control-plane/routes.mjs`: added `GET /v1/tenant/plan/effective-entitlements` and `GET /v1/tenant/effective-capabilities` with `auth:'tenant_owner'`, delegating to the existing provisioning-orchestrator actions
  - `apps/web-console/src/lib/console-context.tsx` (localStorage guards): `readContextStorage`, `writeContextStorage`, `clearPersistedConsoleContext` now guard against `window.localStorage` being undefined (defensive; aligns existing behavior with jsdom test env)
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.
  - Control-plane runtime (deploy/kind): routes added above. The provisioning-orchestrator actions (`tenant-effective-entitlements-get.mjs`, `tenant-effective-capabilities-get.mjs`) already support `tenant_owner` callers — no change needed in services/.

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes.
  - All 7 bbx scenarios pass; 3 vitest operator scenarios pass
  - Pre-existing failing set unchanged (no new failures introduced): 34 baseline failures → 30 post (4 pre-existing fixed as a side effect of localStorage guard, 3 new tests added)
- [x] Acceptance: An operator logs in and sees their own tenant/workspaces/plan.
  - Verified via bbx-coctx-01,04 (own-tenant entitlements/capabilities) + console-context vitest operator tests

## Archive
- [ ] `openspec validate fix-console-operator-tenant-context --strict`; `/opsx:archive fix-console-operator-tenant-context` after merge.
