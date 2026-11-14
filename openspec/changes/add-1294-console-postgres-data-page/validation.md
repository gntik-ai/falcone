# Validation evidence

Local results of the final source, recorded by the maker. Browser journeys cannot run in the maker sandbox.

## Local checks

- PASS: `cd apps/web-console-next && node_modules/.bin/vitest run tests/consolePostgresData.test.tsx tests/consolePostgresData-keys.test.tsx tests/consolePostgresData-busy.test.tsx tests/consolePostgresData-workspace.test.tsx tests/consolePostgresData-routing.test.tsx tests/consolePostgresData-locale.test.tsx tests/consolePostgresData-legibility.test.tsx` (7 files, 53 tests, plus the legibility case).
- PASS: `cd apps/web-console-next && node_modules/.bin/vitest run tests/overview-shell.test.tsx tests/consolePostgres-routing.test.tsx tests/router.test.tsx` with only the two authorized assertion edits.
- PASS: `cd apps/web-console-next && node_modules/.bin/tsc --noEmit`.
- PASS: `node scripts/lint-colours.mjs src/pages/consolePostgresData.tsx src/pages/consolePostgresData` (no bg-white, text-black, bg-black, text-white, bracketed or palette colour, no `dark:` variant, no inline style colour, no gradient).
- PASS: `node scripts/lint-i18n.mjs`, `node scripts/check-i18n.mjs` (es and en catalogs match), `node tests/parity/validate.mjs`, `node tests/parity/scan-fixtures.mjs`.
- PASS: `playwright test --list` registers 48 checks for the page (eight checks, two locales, three viewports).
- PASS: `cd apps/web-console-next && node_modules/.bin/vite build` (the page is its own lazy chunk); `node --test tests/check-i18n.test.mjs tests/lint-i18n.test.mjs` (14/14).
- PASS: `openspec validate add-1294-console-postgres-data-page --strict`.
- PASS: `package.json` and `pnpm-lock.yaml` are unchanged; `tests/browser-session.mjs` and `tests/csp/assets.spec.mjs` are unchanged.

## Parity harness corrections (checker findings on the first attempt)

- The runtime-health journey reaches `/console/postgres` through the sidebar. Its `GET /v1/postgres/databases?page[size]=100` is answered by a separately recorded navigation mock (`h.navigation`); the data page's own `h.calls` allowlist stays strict and every other request is still unmatched.
- The rows-with-filters capture now waits for a populated table: the `pg-rows-filtered` fixture answers `id=eq.acc_01` with one row.
- The locale scan exempts the header and cell text of the rows and preview tables, as well as the schema.table heading, so data such as `customer.name` or `example.com` is not read as a translation key. Interface copy and every accessible name stay checked.
- `tsc --noEmit` is clean: two kit-typed props (`action`, `back`) use the kit's `primaryAction` prop type.
- SKIPPED: Chromium parity journeys (Chromium unavailable; PR CI runs them). `playwright test --list console-postgres-data-page` registers 48 checks.

## Full suite

`cd apps/web-console-next && node_modules/.bin/vitest run` (SHELL_TEST_FIXTURES unset) was run twice. Run one: 2670 passed, 2 failed
(`overview-shell` "switching to a tenant without summaries..." and `router` "the overview renders under base /next/"); run two with
`--maxWorkers=3`: 2671 passed, 1 failed (`shell` "'plans' keeps navigation visible..."). Each failing file passed when run alone
(17/17 and 56/56). The failures are short-wait timeouts under load in tests this change does not touch; the pull request CI decides.

## Existing test edits

Only `tests/overview-shell.test.tsx` (one added `isMigratedRoute('/console/postgres/data')` true assertion) and
`tests/consolePostgres-routing.test.tsx` (the `postgres/data` assertion flipped from false to true).

## Kit decisions

- The gntik_ui MCP server was not available, so `validate_page` is NOT_RUN; the pinned installed kit (0.12.0, tokens 0.4.0) and the Falcone colour lint were used instead.
- The `confirm-destructive` block hard-codes the English label "Type {name} to confirm", which cannot be replaced, so row delete and key revoke use the AlertDialog composite with a typed-confirmation field and catalog copy, as the gap-kit-builtin-copy-english interim allows. Behaviour is the same: the confirm button stays disabled until the exact row id or key prefix is typed.

## Environment skips and approval gates

- SKIPPED: Chromium parity journeys, axe, the three viewport runs and `tests/csp/assets.spec.mjs`: Chromium unavailable; PR CI runs them.
- Screenshot assessment and visual baseline approval happen in the PR CI visual-review journey and at operator approval. The journey captures the select-table prompt, rows with filters, the pending mutation, the edit drawer, the anon and service reveals after a preview (key and snippets masked), both confirmations, the revoked key, the empty key list, the key no-access state, the rows not-found state and the error state, in es and en at 375, 768 and 1280 pixels.
- R3 and the gateway-only blocker (gap-falcone-gateway-only) still gate exposure. No merge, deployment, push, credential access or deployment-repository change was performed.
