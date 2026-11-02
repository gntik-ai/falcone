# Web console test harness

## ADDED Requirements

### Requirement: No test timer runs after the test environment is torn down

The shared `afterEach` in `apps/web-console-next/tests/setup.ts` SHALL, after unmounting, run the timers a test left pending when fake timers are enabled and restore real timers, and SHALL cancel the real timers a test left pending. The harness SHALL NOT catch or suppress errors.

#### Scenario: Real timer pending at unmount

- GIVEN a component that schedules `setTimeout(() => setState(...))` and is unmounted by cleanup
- WHEN the test ends with the timer still pending
- THEN the callback does not run afterwards and vitest reports no unhandled error.

#### Scenario: Fake timers left enabled

- GIVEN a test that enables fake timers and leaves a timer pending
- WHEN the test ends
- THEN the pending timer runs inside `act()` while the environment is alive and real timers are restored.

#### Scenario: Failures stay visible

- GIVEN a test that fails an assertion or throws
- WHEN the settle step runs
- THEN the test is still reported as failed.

#### Scenario: Kit leak documented

- GIVEN `@gntik-ai/blocks@0.11.0` `ErrorPanel` (`ErrorPanel.tsx:94`) does not clear its copy-feedback timer on unmount
- THEN the safeguard covers it until the upstream fix (https://github.com/gntik-ai/gntik-ui/issues/779) is released and adopted.
