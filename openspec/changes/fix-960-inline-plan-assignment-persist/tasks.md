## 1. Source Implementation

- [x] 1.1 Reproduce assigned=true with no committed assignment through the exported helper and
  real plan actions before changing source; use a database fake that dispatches pooled COMMIT to
  another session.
- [x] 1.2 Acquire one client for slug lookup and plan-assign; retain repository transaction ownership.
- [x] 1.3 Release acquired clients once in finally, preserving never-throw behavior for acquisition,
  action, lookup, loader and release failures; leave directly supplied clients borrowed.
- [x] 1.4 Preserve bbx-tp-01..05 and add committed UUID/slug reads, history, draft, unknown-slug,
  rollback, commit-failure, connection-failure and release coverage.
- [x] 1.5 Document connection ownership and the meaning of assigned=true.

## 2. Bounded Verification

- [x] 2.1 Run the regression suite with temporary import-boundary stand-ins for unavailable,
  unused kafkajs/mongodb/pg packages; stand-ins throw if those drivers are instantiated.
- [ ] 2.2 PR CI: run node --test tests/blackbox/tenant-create-plan-besteffort.test.mjs with installed
  dependencies. The source sandbox lacks kafkajs, and offline pnpm installation fails with EPERM.
- [ ] 2.3 PR CI: validate with real PostgreSQL that an active UUID and slug persist assignment and
  history, draft/unknown/failing assignments retain the tenant, and no session is idle in transaction.
- [ ] 2.4 Release gate: revalidate POST /v1/tenants and follow-up plan/history reads on staging,
  including the draft-plan control. No network or database is available in the source sandbox.
- [x] 2.5 Run openspec validate fix-960-inline-plan-assignment-persist --strict.

## 3. Follow-up Decisions

- [ ] 3.1 Track separately whether saga.complete failure after plan commit needs compensation.
- [ ] 3.2 Decide whether an audit/backfill of missing assignments is required before release.
