## Why

Three independent fail-open patterns sit on the restore safety path:
the simulation profile allow-list uses substring matching (and admits
profiles like `integration-prod`), and two security-critical prechecks
return non-blocking outcomes when the adapter is null or throws. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B4** (`operations/restore-simulation.types.ts:50-53`) —
  `isSafeSimulationProfile` uses `normalized.includes(allowed)`;
  `'integration-prod'`, `'integration-east'`, `'integration-staging-mirror'`
  all pass.
- **B7** (`prechecks/snapshot-exists.precheck.ts:17-23`) — returns
  status `'ok'` with detail `'unavailable'` when `adapterClient === null`;
  the snapshot-exists check silently passes.
- **B8** (`prechecks/active-connections.precheck.ts:46-52`) — returns
  `warning` on ANY adapter exception; no distinction between "zero
  connections" and "adapter crashed". DoS-bypassable.
- **B16** (continuation of B4) — `'integration'` substring also matches
  `'integrationcd'`; new "safe" tokens leak in over time.
- **G20** (`G-S3.3`) — snapshot-exists and active-connections fail-open
  (same as B7/B8, raised).
- **G22** (`G-S5.1`) — adapter failures in the collector are silent
  (`collector.action.ts:67-69`); same pattern as B8 at the collector
  layer.

## What Changes

- Replace `isSafeSimulationProfile`'s substring logic with strict
  equality against `SAFE_SIMULATION_PROFILES`; never match by
  `.includes()`.
- Change `snapshot-exists.precheck` to return `blocking_error` (not
  `ok`) when the adapter is null, missing, or throws; the check is
  security-critical and MUST fail-closed.
- Change `active-connections.precheck` to return `blocking_error` (not
  `warning`) when the adapter throws an unexpected error; only legitimate
  "zero connections" results SHALL produce a non-blocking outcome.
- Log adapter type + error on every silent-failure code path in the
  collector and prechecks; never swallow an adapter exception
  unannotated.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on simulation-profile allow-list
  strictness and security-precheck fail-closed semantics.

## Impact

- **Affected code**:
  `services/backup-status/src/operations/restore-simulation.types.ts`,
  `services/backup-status/src/prechecks/snapshot-exists.precheck.ts`,
  `services/backup-status/src/prechecks/active-connections.precheck.ts`,
  `services/backup-status/src/collector/collector.action.ts`.
- **Migration required**: none.
- **Breaking changes**: any deployment configured with a profile name
  containing `'integration'` but not exactly `'integration'` (e.g.,
  `'integration-east'`) will no longer be accepted as a safe-simulation
  target. Operators must rename to `sandbox` or extend
  `SAFE_SIMULATION_PROFILES`.
- **Cross-cutting**: prechecks that previously degraded silently when
  an adapter was stubbed (4 of 5 adapters, per B13) will now block
  restore confirmations; this surfaces the gap that
  `complete-l1-adapter-stubs` addresses.
