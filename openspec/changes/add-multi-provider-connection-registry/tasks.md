# Tasks

- [x] Add failing tests at the HTTP connection and compatibility seams.
- [x] Add named stores, limits, default transactions and tenant isolation.
- [x] Add the transactional legacy row copy and old-executor mirror trigger.
- [x] Preserve singular route responses, completion defaults and worker read safety.
- [x] Preserve structural authorization and BYOK confinement; catalogue new writes.
- [x] Add PostgreSQL 17 migration and rollout integration coverage and CI steps.
- [x] Document accepted rollout and rollback staleness.
- [x] Reproduce the purge-completeness regression, include all connections in tenant purge, and add real-database coverage for non-default/API-only rows and neighboring tenants.
- [x] Reproduce singular PUT display-name loss through HTTP and preserve names in both stores, including default-row promotion.
- [x] Reproduce PostgreSQL-store malformed unknown PUT returning 400 and make unknown items consistently return 404.
- [x] Expand workspace, tenant and connection parameter names in registry methods.
- [x] Run scoped store, registry, compatibility, route-catalog and purge checks after the fixes.
- [ ] Run PostgreSQL integration in CI (database unavailable in the maker sandbox).
- [ ] Run the existing socket-based completion suite in CI (the earlier checker passed it; the follow-up maker sandbox returns `listen EPERM: operation not permitted 127.0.0.1`).
