# Tasks

- [x] Document per-run public API provisioning, naming, safe handoff, and sweep ownership/TTL.
- [x] Test name bounds/uniqueness, handoff allowlisting, and stale-fixture selection offline before implementation.
- [x] Add reusable setup, object-first teardown, finally wrapper, and scoped TTL sweep.
- [x] Add bearer-authenticated LIVE GATE smoke covering I/O, denial, concurrency and failure cleanup.
- [x] Repair provision-spec afterAll and remove the stale no-delete-route assumption.
- [x] Disable token/provision tracing and release retained API response bodies.
- [ ] Authorized real-stack run: object I/O, cross-tenant/no-token denial and concurrent isolation.
- [ ] Authorized real-stack run: stale sweep selects only expired fixture buckets in the caller workspace.
- [ ] Authorized real-stack run: repeat provision spec and verify bucket count does not grow.

Live tasks remain unchecked when the environment gate skips; a skip is not a
successful live assertion. No deployment execution is part of this ChangeSet.
