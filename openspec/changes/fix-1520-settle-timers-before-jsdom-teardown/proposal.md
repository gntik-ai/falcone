# Settle pending timers before jsdom teardown in web-console-next unit tests

## Why

`pnpm --filter @in-falcone/web-console-next test` fails intermittently even when every test passes. Example: `main` CI run 41386083177 (commit c6117890) reported `Errors 1`: an uncaught `ReferenceError: window is not defined` from React `dispatchSetState` inside a `@gntik-ai/blocks` `Timeout._onTimeout`, and `vitest run` exited 1.

The source is the `@gntik-ai/blocks@0.11.0` `ErrorPanel` copy-feedback timer (`ErrorPanel.tsx:94`), which is not cleared on unmount. The upstream issue is https://github.com/gntik-ai/gntik-ui/issues/779 (fixed on gntik-ui main by #134, not yet released). `tests/consolePlanCreate.test.tsx` clicks the copy button with real timers and ends at once; `tests/setup.ts` runs RTL `cleanup()` but leaves the timer pending, so it fires after the jsdom environment is torn down.

## What changes

- `apps/web-console-next/tests/setup.ts`: after `cleanup()` in the shared `afterEach`:
  - if a test left fake timers enabled, run what is pending with `vi.runOnlyPendingTimers()` inside `act()` and call `vi.useRealTimers()`;
  - real timers created through `setTimeout` during the test are tracked per test (installed in `beforeEach`, restored in `afterEach`) and the ones still pending are cleared. Nothing is awaited, so the suite pays no extra time.
- `apps/web-console-next/tests/setupTimerTeardown.test.tsx`: kit-independent regression with a local component whose `setTimeout` calls a state setter after unmount, with real timers and with fake timers left enabled, plus `test.fails` checks that assertion failures and thrown errors are still reported.
- The kit is not bumped or patched and no product code changes. The safeguard stays valid after the kit release that includes the upstream fix.

## Design note

Clearing was chosen over waiting for real timers (the copy-feedback timer lasts 1.5-2 s, so waiting would add seconds per test over ~1444 tests). The cost is that a timer leaked by Falcone product code is also cancelled in tests; timer behaviour that matters must be asserted inside the test, as the existing fake-timer suites do. No global error handler is added: `uncaughtException`, `unhandledRejection`, `window.onerror` and `onUnhandledError`/`dangerouslyIgnoreUnhandledErrors` are not used.

## Out of scope

Product source, `@gntik-ai/blocks` version or patches, `vite.config.ts`, Playwright shell tests, the falcone-charts repository.

## Risk and rollback

R1, test infrastructure only. Roll back by reverting the commit.
