## 1. Failing tests

- [ ] 1.1 [test] Add `services/scheduling-engine/src/cron-validator.test.mjs`
      with cases asserting (a) `* * * * 7` matches a Sunday probe and (b)
      `* * * * 0` matches the same probe, proving B5 at
      `cron-validator.mjs:5,44`.
- [ ] 1.2 [test] Add a case to the same file that submits a 6-field
      expression and asserts the error code is `CRON_SECONDS_UNSUPPORTED`,
      and a 7-field expression that yields `CRON_YEAR_SUFFIX_UNSUPPORTED`,
      proving B6 at `:36-37`.
- [ ] 1.3 [test] Add a case to
      `tests/integration/scheduling-management-action.test.mjs` that submits
      `POST /jobs` with `cronExpression: '* * * * *'` against a workspace
      whose `min_interval_seconds = 3600`, and asserts the response is
      `400 CRON_BELOW_FLOOR`, proving B3 at `quota.mjs:15-17`.

## 2. Implementation

- [ ] 2.1 [fix] Change `FIELD_RANGES[4]` in `cron-validator.mjs:5` from
      `[0, 7]` to `[0, 6]` and map `7 → 0` inside `expandPart` for the
      weekday slot before evaluation; remove the no-op ternary at `:44`.
- [ ] 2.2 [fix] Tighten the field-count check at `cron-validator.mjs:36-37`
      to emit `CRON_SECONDS_UNSUPPORTED` for 6 fields,
      `CRON_YEAR_SUFFIX_UNSUPPORTED` for 7 fields, and `CRON_FIELD_COUNT` for
      anything else.
- [ ] 2.3 [fix] Call `assertCronFloor(expr, config.min_interval_seconds)`
      inside `POST /jobs` at `scheduling-management.mjs:124-154` after
      `validateCronExpression`; surface failures as `400 CRON_BELOW_FLOOR`.
- [ ] 2.4 [fix] Apply the same `assertCronFloor` call inside
      `PATCH /jobs/{id}` at `scheduling-management.mjs:203-220` whenever
      `body.cronExpression` is present.
- [ ] 2.5 [fix] Remove the unused `cron-parser` dependency from
      `services/scheduling-engine/package.json:12`.

## 3. Validation

- [ ] 3.1 [docs] Document the `+1 minute` advance semantics of `nextRunAt`
      and the three field-count codes in `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and
      `corepack pnpm test:integration`; both green before merge.
