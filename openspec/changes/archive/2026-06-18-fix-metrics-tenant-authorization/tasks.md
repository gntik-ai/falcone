# Tasks — fix-metrics-tenant-authorization

## Reproduce (test-first)
- [x] Add a failing black-box probe: `tests/blackbox/metrics-tenant-authorization.test.mjs` (tenant B reads tenant A quotas/overview/usage/series/audit + non-existent id → must be 403).

## Implement (kind runtime AND shippable product)
- [x] Apply the own-tenant guard (tenant owners/admins → own only, superadmin/internal → any) to ALL metrics routes via a `guarded()` wrapper + `resolveScopeTenant()` (resolves workspace→tenant for workspace routes) in `deploy/kind/control-plane/metrics-handlers.mjs`; uses the shared `canManageTenant` from `tenant-scope.mjs`.
- [x] The product metrics surface (`apps/control-plane/src/observability-admin.mjs`) is descriptor/summary-only; the kind control-plane is the live request handler, so the fix is confined there.

## Verify
- [x] Black-box suite green (718 pass); new test `metrics-tenant-authorization` 8/8; existing `metrics-quotas-degrade` still green (ctx updated to include the JWT identity the server always injects).
- [x] Acceptance: Cross-tenant metrics → 403; own → 200; superadmin → 200; non-existent tenant id (for a tenant operator) → 403; unknown workspace → 404.

## Archive
- [ ] `openspec validate fix-metrics-tenant-authorization --strict` (passing); `/opsx:archive fix-metrics-tenant-authorization` after merge.
