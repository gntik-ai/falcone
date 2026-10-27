# Stabilize console operations parity helpers

## Why

Issue #1257 now includes the clock race from #1255. The supplied ui-parity
failure is the red evidence: the installed clock runs between `install` and
`pauseAt`, so pausing at the installation instant can fail with
`Cannot fast-forward to the past`. The existing `choose()` fix already scopes
options to the opened combobox's controlled listbox and drains closing popups.

## What changes

- Preserve `choose()` and its single-visible-listbox fallback.
- Install the fake clock at exactly `2026-06-01T11:59:59Z`, then pause at
  exactly `2026-06-01T12:00:00Z`. Keep the target instant and all bookkeeping
  after `pauseAt` unchanged. Keep `runFor` timer semantics.
- Keep every existing assertion, fixture, manifest, harness and shared check.
  Add no retries, sleeps, skips or timeout changes.

Only `choose()` and `freeze()` in
`apps/web-console-next/tests/parity/pages/console-operations.spec.mjs` and
this OpenSpec folder are in scope. Retain the previous local commits; the
additional implementation changes only `freeze()`. Inherited Hermes chart
pins are untouched. No product or deployment changes are required.

## Risk and validation

R1, test-only; rollback reverts the additional source commit. A runner taking
more than 1000 ms between the clock calls could still reproduce the race.

The public regression seam is the existing operations browser journeys across
both roles, es/en and widths 375/768/1280. Keep the 30s poll, 1s/3s retry,
499/1 ms reconnect and 29,999/1 ms poll-boundary assertions unchanged.

Source review confirms every `freeze()` call precedes either initial
navigation or a new navigation after a settled page. The measured poll/retry
timers are scheduled after that navigation, and reconnect debounce requires
an online/visibility event dispatched later in the journey. Settled mixed
lists can already have a native 30s poll pending before clock installation;
the following navigation replaces that page. Browser execution must confirm
the pre-window leaves these journeys unchanged.

Run repository parity tooling, syntax checks and Playwright test discovery
locally. Chromium is unavailable in the maker sandbox: full browser parity,
axe, viewport and repeated flake checks remain PR CI gates. Require two
successful ui-parity runs and independent screenshot assessment with operator
approval; do not claim local discovery proves browser behavior.
