# Flow designer migration review

Page: `console-flow-designer-page`, issue #1288, risk R2. Blueprint SHA256:
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Delivery base: `33b4c9ef6a32caee57c1b711733896ad1dd416dc`.

The existing migration remains in place. The follow-up preserves the legacy
palette's `Error.message` details, including its fallback for non-Error failures,
with application-owned copy in both catalogs. Browser coverage now includes
selected-node inspector and validation Problems screenshots and keyboard focus
from a Problems row. The legacy page and deployment worktree are untouched.

## Changed pre-existing tests

Only `tests/consoleFlows-routing.test.tsx` changes, in the three cases of
`flows has no role gate for %s under /next`: `superadmin`, `tenant_viewer`,
and `workspace_viewer`. The designer migration assertion becomes true; the list
migration assertion stays true. A comparison against the base verifies that this
single assertion is the entire diff of pre-existing test cases.

`history stays in-router while designer is a root-relative legacy anchor` stays
byte-identical. `src/pages/consoleFlows.tsx:165` renders the designer as a plain
anchor; line 167 uses a hard-coded RouterLink for history. Neither reads the
migration flag. The browser-session harness adds only the two synthetic on-load
GET responses permitted by the proposal.

The new rollback tests remove the designer migration flag and prove pendingPage,
no designer requests, the legacy list anchor and `isMigratedRoute(...) === false`.
The router's designer branch also checks the flag. Operational rollback removes
both the route flag and the designer lazy branch.

## Parity boundaries

Page traffic remains GET flow, GET task-types, PATCH draft, POST versions and
POST schedule/trigger, through `@in-falcone/console-api/session`. PATCH retains
its raw rejection; only versions normalizes validation errors. PATCH 422 keeps
the canvas undecorated and dirty and does not publish. Versions 422 decorates
nodes and lists flow-level Problems. The routing tests cover one refresh and one
replay on refresh success, and no replay with a login return path on rejection.

The graph projection and connection rules differ from legacy only in import
paths; semantic validation still calls the shared validator. Post-blueprint
validation parameters, localized diagnostics and interaction rejection details
remain carried over. The flow-builder and code-panel blocks remain unused;
CanvasLayout follows workflow-builder with kit panels around the wrapped canvas
and lazy Monaco editor. Kit props are explicit, with no sample fallback data.

## Environment checks

The Hermes-supplied gntik-ui 0.11.0 snapshot is the kit reference; no network fetch
was used. `validate_page` is NOT_RUN because the MCP server is unavailable.
Colour lint and an additional scan reject palette colours, bracketed colour
classes, raw colour functions, dark variants and decorative gradients.

Browser parity, axe, viewport and CSP execution: SKIPPED — Chromium unavailable;
PR CI runs them. Discovery covers 66 designer cases across es/en and
375/768/1280 px, plus the three existing CSP asset cases. Visual screenshots need
the independent checker's assessment and operator approval; CI does not approve
their appearance.

## Sandbox failure comparison

All commands below run from `apps/web-console-next` without
`SHELL_TEST_FIXTURES=true`.

- `pnpm exec vitest run --reporter=json --outputFile=/tmp/flow-designer-final-full.json`:
  exit 0, 69 files passed, 1,268 tests passed, zero failed, three skipped.
- `pnpm exec vitest run tests/consoleFlowDesigner.test.tsx tests/consoleFlowDesigner-routing.test.tsx tests/consoleFlowDesigner-rollback.test.tsx tests/consoleFlows-routing.test.tsx`:
  exit 0, four files and 50 tests passed.
- `pnpm typecheck`, `pnpm lint:colours`, `pnpm check:i18n`, `pnpm lint:i18n`,
  `pnpm build`, `pnpm parity:validate`, `pnpm parity:scan` and
  `pnpm validate:dist`: each exit 0. The catalogs contain 176 matching keys each.
- `pnpm exec playwright test --config tests/parity/playwright.config.mjs pages/console-flow-designer-page.spec.mjs --list`
  and `pnpm exec playwright test --config tests/csp/playwright.config.mjs assets.spec.mjs --list`:
  exit 0. Discovery verifies registration, not browser execution.

The prior maker's seven failures in three untouched files do not reproduce in
this sandbox run. There are no failing HEAD files to classify as environment
skips, and no files to pass to `--exclude`. The exact full-suite command above
therefore runs the complete suite with no exclusions; its actual exit is 0.
No failure is relabeled SKIPPED without matching base and HEAD names/messages.

The three normal-suite skips are intentional in `tests/shell-fixtures.test.tsx`:
`a render failure leaves translated 500 and navigation without exception text`,
`pending lazy fixture navigation works through a link`, and
`pending lazy fixture navigation works through a button`. Their fixture routes
are enabled only for the separate fixture builds and browser jobs in CI.

Base comparison uses a fresh archive of the delivery base in
`/tmp/flow-designer-base`, with the same installed dependencies, same Vitest
configuration and same sandbox as HEAD. No untouched test file is edited.

The archived base full run returned exit 1: 1,230 passed, three intentional
fixture skips, and two import-resolution errors in `consoleFlowHistory.test.tsx`
and `consoleFlows.test.tsx`. These were archive setup errors: the legacy app's
`node_modules` symlink was missing, so the legacy clients could not resolve
`@in-falcone/console-api/session`. Restoring the same installed legacy dependencies
and rerunning
`pnpm exec vitest run tests/consoleFlowHistory.test.tsx tests/consoleFlows.test.tsx --reporter=json --outputFile=/tmp/flow-designer-base-client-rerun.json`
at the base returned exit 0, 69 passed. The same command at HEAD with output file
`/tmp/flow-designer-head-client-rerun.json` also returned exit 0, 69 passed. Test
names, statuses and failure-message arrays are identical across those reruns.
Every other base file passed in the full run. This comparison does not classify
either import error as a source regression or use it to exclude a HEAD file.

The changed files in this follow-up are the palette wrapper, its two catalogs,
the new designer unit and browser tests, and this evidence inventory. The
earlier migration commits and Hermes-managed chart pins are preserved.
