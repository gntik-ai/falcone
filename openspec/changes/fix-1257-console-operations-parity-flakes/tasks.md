# Tasks

- [x] Verify the clean assigned worktree, issue branch and initial HEAD
  `876c66c699f5db450da78c29c7c4a0b50ed34b93`.
- [x] Review existing commits against the amended issue; keep the scoped
  `choose()` lookup, drain wait and visible-listbox fallback.
- [x] Use the supplied failing ui-parity run as red evidence for the clock
  race; keep existing browser assertions as the regression seam.
- [x] Install the clock 1000 ms before the unchanged paused instant, using
  `install` then `pauseAt`, with unchanged bookkeeping after the pause.
- [x] Review freeze call sites, poll/retry scheduling and event-driven
  reconnect timing; document the pre-window validation limit.
- [x] Run bounded repository parity tooling, syntax and discovery checks.
- [ ] PR CI: full console-operations role x locale x width matrix, including
  action, error-empty, accessibility, runtime-health and lifecycle journeys.
- [ ] PR CI: repeat action, error-empty and accessibility at least ten times,
  with no strict-mode or past-clock errors.
- [ ] Browser-capable validation: temporarily restore the old installation
  instant, observe the clock failure under repetition, then restore the fix
  without committing the temporary change.
- [ ] Delivery: record two successful ui-parity CI run IDs.
- [ ] Independent checker: assess parity screenshots and obtain operator
  approval for visual review.

Browser checks remain pending because Chromium is unavailable in this sandbox.
No assertions or test files were added, removed, weakened or narrowed.

## Verification

- PASS: `node --check apps/web-console-next/tests/parity/pages/console-operations.spec.mjs`.
- PASS: `node --test tests/unit/web-console-next-ci.test.mjs`.
- PASS: `node --test tests/unit/parity-tools.test.mjs`.
- PASS from `apps/web-console-next`: `node tests/parity/scan-fixtures.mjs`
  and `node tests/parity/validate.mjs`.
- PASS from `apps/web-console-next`:
  `node node_modules/@playwright/test/cli.js test --config tests/parity/playwright.config.mjs pages/console-operations.spec.mjs --list`;
  168 cases discovered, covering the unchanged matrix and lifecycle journeys.
- PASS: `git diff --check`.
- SKIPPED: pnpm scan, validation and discovery commands cannot start because
  pnpm's Node-version probe fails with `spawnSync /usr/local/bin/node EPERM`.
  Their underlying tools pass directly as recorded above.
- SKIPPED: browser parity, axe, viewport, repeat and negative clock runs:
  Chromium unavailable; PR CI runs them. No new CI run IDs are available in
  this network-disabled maker invocation.
