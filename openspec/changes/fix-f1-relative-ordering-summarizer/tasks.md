## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to `tests/unit/event-gateway-runtime.test.mjs`
      that calls `summarizeRelativeOrdering` with two deliveries in the
      same group whose `sequence` numbers are `[5, 3]` in arrival order
      and asserts a violation is recorded with `previous.sequence=5,
      current.sequence=3`.
- [ ] 1.2 [test] Add a case that supplies three groups and asserts that
      after the call, the returned `summaries` object carries
      `{deliveries, sequenceSpan}` for each group AND the function's
      internal `groups` Map is not mutated to that shape (regression for
      B11).
- [ ] 1.3 [test] Add a case with no `sequence` field on the deliveries
      and asserts the function does not throw and reports
      `ok: true, violations: []` (defensive coverage tied to G10).

## 2. Implementation

- [ ] 2.1 [fix] Remove the dead `sorted = […].sort(…)` array at
      `services/event-gateway/src/runtime.mjs:840`; track
      `min`/`max` sequence during the arrival-order walk instead.
- [ ] 2.2 [fix] Replace the in-place `groups.set(groupKey, {...})` at
      `:849` with population of a separate `summaries` map after the
      iteration completes; leave the source `groups` map intact.
- [ ] 2.3 [fix] Add a JSDoc block on the exported function declaring its
      contract: "Detects out-of-order arrival within each
      (partition, key) group, where 'out of order' means
      `current.sequence <= previous.sequence` in arrival order."
- [ ] 2.4 [impl] Extend the return shape to
      `{scope, checkedGroups, violations, ok, summaries}` and update the
      two internal call sites in `runtime.mjs` to read from `summaries`.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:unit --
      event-gateway-runtime` and `openspec validate
      fix-f1-relative-ordering-summarizer --strict`; both green before
      merge.
