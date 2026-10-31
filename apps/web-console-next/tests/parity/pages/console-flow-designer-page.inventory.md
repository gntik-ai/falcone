# Flow designer migration review

Page: `console-flow-designer-page`, issue #1288, risk R2. Blueprint SHA256:
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Delivery base: `33b4c9ef6a32caee57c1b711733896ad1dd416dc`.

## Amended-scope review at b42ccc2b

The regenerated proposal retains the existing repairs in `5279392f` and
`b42ccc2b`. The reported CI excerpt predates those repairs: the designer's toast
region now uses the namespace in both locales, the locale scanner exempts only
the canonical `apiVersion` scalar on its YAML line, and the action journey
focuses Monaco's textbox before replacing the document. The shared locale
checker and its assertions remain unchanged. No further runtime change is
needed for those reported causes.

Review against the delivery base confirms that the only changed pre-existing
test is the three cases of `flows has no role gate for %s under /next` in
`tests/consoleFlows-routing.test.tsx`. Its legacy designer-anchor case remains
unchanged because `src/pages/consoleFlows.tsx:165` uses a hardcoded legacy
anchor. `overview-shell.test.tsx` also remains unchanged. The sole pre-existing
harness addition is the two permitted on-load GET fixtures in
`tests/browser-session.mjs`. All designer tests, including the locale scanner
tests, are new relative to the delivery base.

Both catalogs contain 180 matching leaf keys. Type checking, colour lint,
`check:i18n`, `lint:i18n`, parity structure validation and fixture scanning pass.
Isolated Playwright discovery registers 78 designer cases and three CSP asset
cases; discovery does not execute a browser. The final delivery report records
the fresh full-suite result and any isolated reruns without relying on the
historical counts below.

Browser parity, axe, viewport and CSP execution remain SKIPPED: Chromium
unavailable; PR CI runs them. Visual screenshot assessment still needs the
independent checker and operator approval. `validate_page` remains NOT_RUN
because no gntik_ui MCP server is available; the supplied Hermes snapshot is
the kit reference. This review does not change dependencies, workflows, legacy
code, backend code or the deployment worktree.

## CI repair verification after 5279392f

The supplied CI failure is the red evidence for the untranslated toast viewport
and the schema-version false positive. The preceding commit already localizes
the viewport and focuses Monaco's textbox before editing. This follow-up keeps
those repairs and tightens the new page-local locale scanner: only the exact
`v1.0` scalar on Monaco's rendered `apiVersion` line is exempt. Other YAML lines,
untranslated keys, accessible labels and toast names remain scanned.

The locale tests now reproduce Monaco's nested token spans and nonbreaking
spaces, and prove that a different version or the same token on another line
does not receive the schema exception. These are new ChangeSet tests, absent at
the delivery base; no pre-existing assertion is changed by this follow-up.
The shared parity checks, workflows and fixture harness are unchanged.

Browser parity, axe, responsive and CSP execution remains SKIPPED: Chromium
unavailable; PR CI runs them. Screenshot assessment still requires the checker
and operator. `validate_page` remains NOT_RUN because no gntik_ui MCP server is
available; the supplied Hermes snapshot is the kit reference.

## CI parity repair after 6e8e9b99

The toast viewport now receives its accessible name from the designer namespace
in both languages, using the same container-local adapter as the flows list.
Kit 0.11.0 exposes the close label but does not expose the viewport label.
Regression assertions cover the initial es/en region and a live locale change.

The newly added designer parity locale assertion incorrectly classified the DSL
value `v1.0` as an untranslated key. Its page-local scanner retains the shared
whole-document text, accessible-name, attribute and catalog checks, exempting
only the exact schema version inside Monaco's rendered YAML lines. It still
rejects untranslated keys within those lines and checks every attribute there.
Three unit tests verify this boundary, including version-like copy outside the
editor and the English toast region name. The shared checker is unchanged.

The action journey now explicitly focuses Monaco's accessible textbox before
selecting and replacing the document, instead of clicking the editor container.
The invalid-YAML banner and zero-PATCH assertions remain unchanged.

This repair changes no pre-existing tests. Across the complete ChangeSet, the
only changed pre-existing test remains `flows has no role gate for %s under
/next` (superadmin, tenant_viewer, workspace_viewer) in
`tests/consoleFlows-routing.test.tsx`. The designer-anchor test remains
byte-identical because neither flows-list link reads the migration flag.
Browser parity, axe, viewport and CSP execution remains SKIPPED: Chromium
unavailable; PR CI runs them. Screenshot review needs the independent checker
and operator approval. The Hermes kit snapshot remains the reference;
validate_page is NOT_RUN because no gntik_ui MCP server is available.

## YAML revert follow-up to aa7b6942

The latest checker finding F1 is fixed by ignoring YAML change callbacks whose
text already matches the current buffer. Monaco's programmatic `setValue` echo
after reverting therefore preserves the clean state, while subsequent typing
still marks the draft dirty. The persisted definition still reseeds both views.

The designer unit-test editor now reproduces Monaco's external-value echo.
Both new `revert clears local edits in %s despite the Monaco value echo and
subsequent typing marks dirty` cases failed before the fix with the unwanted
`unsaved-changes-indicator`, in YAML and side-by-side views. They verify restored
text, a clean state, one reload, no PATCH, and dirty state on a subsequent edit.
The browser journey adds the equivalent regression for each view, locale and
viewport, including an assertion that the unsaved indicator is absent after
revert. Browser discovery now covers 78 designer cases; browser execution remains
SKIPPED: Chromium unavailable; PR CI runs them. Screenshot assessment still needs
the independent checker and operator approval.

This correction changes only the designer, its migration-specific unit/browser
tests, and this inventory. It changes no tests that existed at the delivery base.
The final structured report records post-commit test results; the evidence below
describes earlier attempts and is retained as history.

## Previous checker fixes

This follow-up to `b362335a508967f05c8239b1569423f9ad56e64f` fixes F1 and F2.
Failed PATCH and versions requests preserve the current dirty state, matching
legacy. A successful PATCH followed by failed publication retains the saved
indicator. A failed save of an unedited draft does not invent unsaved changes;
a failed save after editing retains them. Regression tests cover 403, 422, 500
and network failures, including a failed save after a previous successful save.

Every React Flow accessibility configuration entry now comes from the page
namespace, including the controls panel, connection handle and minimap names.
The two catalogs have 179 matching leaf keys. Unit tests assert every canvas
label in es/en, and browser accessibility cases explicitly assert the rendered
controls panel name and each controls button's title. Browser PATCH 422 coverage
now edits the draft first, and verifies that a subsequent successful PATCH and
failed versions POST retain the saved indicator.

This follow-up changes the designer, its catalogs, its new unit/browser tests,
and this inventory. It makes no additional changes to pre-existing tests.
The final delivery report records the post-commit full-suite command, its real
exit status and any environment exclusions. Browser parity, axe, responsive,
CSP and visual execution remain SKIPPED: Chromium unavailable; PR CI runs them.
Visual screenshot assessment still requires the checker and operator.

## Previous attempt evidence (through b362335a)

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
