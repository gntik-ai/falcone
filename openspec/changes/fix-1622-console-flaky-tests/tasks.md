# Implementation and validation

- [x] Replace the check-then-act Active-context wait in `harness.mjs` with one retrying `toHaveCount(0)` assertion.
- [x] Export `awaitTransitions` from `checks.mjs` and reuse it in `admin-navigation.spec.mjs`.
- [x] Wait for the menu and settled transitions before both axe scans in `admin-navigation.spec.mjs`.
- [x] Re-check `operationDetail.test.tsx` and `consoleFunctionsData.test.tsx` for synchronous assertions on async state; none remain after 41538446.
- [x] Syntax check the three changed `.mjs` files and run the three unit files repeatedly.
- [ ] Browser runs (shell `--grep 'accessibility gate' --repeat-each=30`, parity suite, `harness.spec.mjs`, busy-region negative): SKIPPED in the maker sandbox, Chromium unavailable; PR CI runs them.
