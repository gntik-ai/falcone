# Functions quick-deploy migration evidence

Page: `console-functions-data-page` (route `/console/functions/data`), issue #1298, risk R1, wave u3.
Blueprint SHA256: `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Approved entry SHA256: `222d1fd5e3811a0132ded10f805b1b413968cca29dc049791eab573c0a422151`.
Delivery base: `ed04fe7269d32f3f3e3cbc434ab5168389153ed6`.
Kit: the supplied Hermes snapshot `43939cc7fe75bc5acdeddf0e9dd5b7cded5515a3da9595f348e0deb590f9c5e6`, packages pinned to 0.11.0. No MCP server is configured, so `validate_page` is NOT_RUN; the Falcone colour lint and the kit type definitions stand in for it.

## Kit composition

The resource-index page uses `Page` with explicit `PageHeader`, `PageToolbar`, `SectionHeader`, `DataTable`, `TableSkeleton`, `ErrorPanel`, `InlineCallout` and the empty-state blocks. Every prop is passed explicitly and every label comes from the `pages.console-functions-data-page` catalog in `es` and `en`.

The function list is a `DataTable` in `selectionMode="single"`, `paginated={false}`. Kit 0.11.0 renders native radios in a labelled fieldset (Tab enters once, arrow keys move and select), so `gap-b002-datatable-single-select` needs no interim workaround and no checkbox selection is used. The legend `Funciones disponibles` is the group's `aria-label`. The result uses `JsonViewer` with localized labels; activations use a second non-paginated `DataTable` with `StatusTag`. Stale output carries a `Badge` label and a `Timestamp`. The toolbar's search box is hidden by `page.css`, as in the registry page, because the legacy list has no search.

## Requests

Only `listFunctions`, `deployFunction`, `invokeFunction` and `listActivations` (`src/pages/consoleFunctionsData/api.ts`) are called, through `requestConsoleSessionJson`, so a 401 gets one refresh and one replay. `getFunction`, delete, export and import are never called. `toFunctionActionWriteRequest` and `toFunctionInvocationWriteRequest` are field-for-field copies of `apps/web-console/src/services/functionsApi.ts:169-237`; the unit tests deep-equal the default deploy, the structured deploy and the three invoke inputs. `packages/console-api` has no functions helpers and the ChangeSet limits edits to `apps/web-console-next`, so the module lives beside the page.

## Legacy delta since the blueprint

`fecb3a03..ed04fe72` only moved imports to `@in-falcone/console-api` (HTTP types, permissions, session and context loaders). No behaviour, API call, validation, state or copy of this page changed, so nothing further was carried over.

## Intended differences

- Per-operation `ErrorPanel` with status code, request id and Reintentar replaces the legacy single shared alert. Earlier result or activations appear only under `Resultado anterior` or `Lista anterior` with a timestamp until a retry succeeds. Typed JSON is never cleared.
- Validation messages use `InlineCallout` in the panel that owns the control; the legacy strings are unchanged.
- Success shows a toast and a polite announcement; failure is announced assertively once.
- Focus returns to the triggering button after each operation, or to Reintentar when a retry fails again.
- A 404 from invoke or activations shows a not-found state with `Volver a la lista`; a 403 on the list hides the deploy and invoke panels.
- The shell sets the tenant only after its workspace load succeeds, so loading and failure of that load take precedence over the blocked state.
- The activations table is titled `Activaciones recientes` and is the newest window the backend returns (`gap-b002-activations-recent-cap`); no client paging runs over it.

## Verification

Vitest: `tests/consoleFunctionsData.test.tsx` (rendering, 60 rows, selection, request bodies, validations, busy state, failures and stale output, focus, workspace states, request allowlist) and `tests/consoleFunctionsData-routing.test.tsx` (route flag, sidebar link and `navigate()` without a document load, 401 refresh-ok and refresh-rejected with intent `/next/console/functions/data`, workspace error retry and picker). `tests/overview-shell.test.tsx` gains the one `isMigratedRoute('/console/functions/data')` assertion. `tests/browser-session.mjs` serves only an empty `GET /v1/functions/workspaces/{}/actions` for the CSP route sweep.

Browser parity, axe, viewport (375/768/1280) and CSP runs are SKIPPED here: Chromium is unavailable in the maker sandbox and PR CI runs them. The visual spec covers `invoke-result`, `invoke-500`, `activations-500`, `actions-empty` and `actions-500` in es and en and attaches SHA256-named screenshots; PR CI captures the baselines and operator approval gates the merge.

Kill switch: remove `migrated: true` at `src/shell/routes.ts` for `functions/data` and the matching assertion in `tests/overview-shell.test.tsx`.
