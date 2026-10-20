# Tasks

- [x] Test broker acquisition, cache, expiry skew, concurrent refresh and isolation.
- [x] Test revocation, bounded cached-token 401 recovery and rotation rejection.
- [x] Validate auth on collection POST, item PUT and legacy singular PUT.
- [x] Recheck token endpoints, secret references and verified tenant profile access.
- [x] Integrate completions, streams and batch submission/polling through the broker.
- [x] Keep credentials out of stored configs, snapshots, usage and public errors.
- [x] Add nullable auth/version migrations without adding DDL to worker reads.
- [x] Add PostgreSQL 17 migration/compatibility coverage and register tests in CI.
- [x] Preserve existing API-key behavior and document rollout/revocation limits.
- [ ] Run PostgreSQL integration in CI; no database is available in the maker sandbox.
- [ ] Run the existing socket-based completion suite in CI; sandbox listen returns EPERM.
- [ ] Separate deployment maker: add opt-in profiles and projected token volume;
      check unchanged default renders, configured audience and absence of secrets.
