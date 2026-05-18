## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `tests/integration/scheduling-management-action.test.mjs` that submits
      `PATCH /v1/scheduling/config` with `{maxActiveJobs: -1}` and asserts
      the response is `400 INVALID_CONFIG`; assert no row is written,
      proving B10 at `config-model.mjs:31-54`.
- [ ] 1.2 [test] Add a case that fires two concurrent PATCH calls with
      disjoint field sets and asserts both writes are preserved (no clobber)
      or that the loser receives `409 CONFIG_LOCKED`, proving B12 at the
      same file:line.

## 2. Implementation

- [ ] 2.1 [fix] Add a `validateConfigPatch(body)` helper in
      `scheduling-management.mjs` checking `maxActiveJobs ∈ [1, 1000]`,
      `minIntervalSeconds ∈ [1, 86400]`, `maxConsecutiveFailures ∈ [1, 100]`;
      call it at the top of the `PATCH /config` branch (`:74-100`); surface
      violations as `400 INVALID_CONFIG` with a per-field error map.
- [ ] 2.2 [fix] Rewrite `upsertConfig` (`config-model.mjs:31-54`) to a single
      `INSERT … ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET <col> = COALESCE(EXCLUDED.<col>, scheduling_configurations.<col>)`
      statement that takes only patched fields as bind values; remove the
      preliminary `getConfig` read.
- [ ] 2.3 [fix] Wrap the PATCH handler in a transaction that takes
      `pg_advisory_xact_lock(hashtext(tenant_id || '/' || COALESCE(workspace_id, '')))`
      before the upsert; on lock-not-available timeout (1s) surface
      `409 CONFIG_LOCKED`.
- [ ] 2.4 [impl] In the bulk-disable branch (`scheduling-management.mjs:74-100`)
      iterate the paused jobs returned by `getActiveJobsToSuspend` and emit
      a `jobPausedEvent` per row (in addition to the existing
      `capabilityToggledEvent`).
- [ ] 2.5 [impl] Add a `jobPausedEventForBulk` builder to `audit.mjs` if the
      shape needs to differ from the per-job pause path (e.g., extra
      `metadata.reason: 'capability_disabled'`).

## 3. Validation

- [ ] 3.1 [docs] Document the new bounds, the `409 CONFIG_LOCKED` semantics,
      and the bulk-pause audit shape in
      `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:integration`; green before merge.
