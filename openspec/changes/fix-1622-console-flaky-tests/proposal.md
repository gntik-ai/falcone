# Make the flaky console unit, axe and parity waits deterministic

## Why

Issue #1622: web-console-next CI fails a different timing-dependent test on each run. This is an R1, test-only, source-only change.

- The copy announcement, focus and invoke-input unit races in `tests/operationDetail.test.tsx` and `tests/consoleFunctionsData.test.tsx` were already awaited by commit 41538446. They were re-checked and no synchronous assertion on async state remains.
- The color-contrast flake named for `tests/admin-navigation.test.tsx` is not in that file, which has no axe call. Only `tests/shell/admin-navigation.spec.mjs` runs axe. It scanned straight after clicking the menu trigger and once the menuitem was visible, without waiting for the menu transition to finish, so axe could read blended colours.
- `tests/parity/harness.mjs` `open()` checked `context.count()` and then asserted on the Active-context region. The shell can re-render the region between the two calls, so parity cells failed with "element(s) not found" (operator decision 2026-11-11).

## Changes

- `harness.mjs` `open()`: one retrying assertion, `expect(context.and(page.locator('[aria-busy="true"]'))).toHaveCount(0)`. It passes when the region is absent or not busy, and fails at the expect timeout if the region stays busy.
- `checks.mjs`: export the existing `awaitTransitions` with no behaviour change.
- `admin-navigation.spec.mjs`: the baseline scan waits for the menu to be visible, and both axe scans wait for `awaitTransitions` before analysing. The full axe ruleset, the baseline comparison and the new-entry check are unchanged.

No sleeps, real-time delays, retries, config changes, product source or deployment changes are added.
