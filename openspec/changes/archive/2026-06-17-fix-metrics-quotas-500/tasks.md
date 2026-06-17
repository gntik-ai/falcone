# Tasks — fix-metrics-quotas-500

## Investigation
- [x] `tenantLimits` (metrics-handlers.mjs) delegates to the real tenant-effective-entitlements
  action; its quantitative query reads `quota_dimension_catalog`, `quota_overrides`,
  `plans.quota_type_config` — none provisioned in the hand-built runtime → 42P01.
- [x] The `Forbidden` is NOT a DB GRANT: the entitlements action's `resolveTenantId` enforces a
  stricter actor-type allow-list than the metrics route (`authenticated` + tenant-scoping), so an
  authorized same-tenant non-owner (e.g. tenant_admin) trips FORBIDDEN. Cross-tenant is already
  denied 403 at the route layer (campaign §5), so this is the authorized-caller path.
- [x] `workspaceLimits` already degrades gracefully (try/catch → []); `tenantLimits` did not — the
  asymmetry turned either inner error into a 500.

## Implementation
- [x] `tenant-store.mjs`: `ensureSchema` provisions `quota_dimension_catalog` + `quota_overrides`
  and adds `plans.quota_type_config` (mirroring migrations 098/103), so the entitlements query
  resolves real limits. Idempotent.
- [x] `metrics-handlers.mjs`: `tenantLimits` degrades to `[]` on any error (mirrors
  `workspaceLimits`), so the Quotas page returns 200 (empty/healthy posture) instead of 500.

## Verification
- [x] Real tests/env Postgres: the entitlements action resolves a real effectiveValue post-schema
  with no 42P01; the metrics handler returns 200 (quotas/overview/usage) in every case.
- [x] Black-box test `tests/blackbox/metrics-quotas-degrade.test.mjs` (bbx-f4-01/02).
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-metrics-quotas-500 --strict`.

## Archive
- [x] `/opsx:archive fix-metrics-quotas-500`
