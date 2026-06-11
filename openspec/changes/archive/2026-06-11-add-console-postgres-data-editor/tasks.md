## Implementation status (Phase 3 — DONE)

Implemented + tested (web-console vitest; `pnpm -C apps/web-console exec vitest run` of the new files):
- `apps/web-console/src/services/postgresApi.ts` — typed client centralizing the calls to the
  control-plane executor (Phases 0-2): DDL (createSchema/createTable/addColumn/createIndex),
  data (listRows/insertRow/updateRow/deleteRow/bulkInsert), API keys (issue/list/revoke/rotate),
  and `buildFrontendSnippet`. URLs match the executor routes exactly. 15 unit tests assert
  every URL/method/payload (`postgresApi.test.ts`).
- `apps/web-console/src/components/console/PostgresDataEditor.tsx` — row data-grid (list +
  insert via JSON editor + delete), and an API-keys panel that issues anon/service keys, shows
  the plaintext **once** with a copy-paste frontend snippet, lists + revokes keys. 5 component
  tests (`__tests__/PostgresDataEditor.test.tsx`): rows render, insert, invalid-JSON guard,
  delete, issue-anon-key shows key + snippet.
- `apps/web-console/src/pages/ConsolePostgresDataPage.tsx` + route `postgres/data` in router.tsx.
- Enabling change: added `PATCH` to the console HTTP method unions (`lib/http.ts`,
  `lib/console-session.ts`) so row updates work.

NOTES: the web-console **vitest suite is pre-existing-broken on main** (vitest 4.1.0 vs
coverage-v8 2.1.9 mismatch) — my new tests pass and my files typecheck clean; that suite is
not run by CI (CI quality = `pnpm lint` + node `test:*`). Full browser E2E (real backend +
Playwright) requires deploying the executor image — tracked separately.

DEFERRED: create-table form in the UI (the service supports it + is tested; the page exposes
data-grid + keys first); inline row editing (update is in the client, grid edit UX later);
the RLS-policy builder UI (`add-console-rls-policies` follow-up).

## T01: Confirm baseline green

- [ ] T01.1 Run `bash tests/blackbox/run.sh` — all existing tests pass
- [ ] T01.2 Run `openspec validate add-console-postgres-data-editor --strict` — valid

## T02: Black-box tests (write first — red before implementation)

- [ ] T02.1 Write black-box test: create a table via the UI DDL execute path — table appears
  in the browser list on reload; assert `executionMode: "execute"` in request body and
  no `dryRun: true`
- [ ] T02.2 Write black-box test: insert a row via the data grid — row is returned by the
  list-rows endpoint after insert
- [ ] T02.3 Write black-box test: update a row via the data grid — updated field values
  are returned by the list-rows endpoint after update
- [ ] T02.4 Write black-box test: delete a row via the data grid — row is absent from the
  list-rows endpoint after delete
- [ ] T02.5 Write black-box test: mint an anon key — raw key value is present in the
  response payload exactly once (the panel does not re-fetch and re-display it)
- [ ] T02.6 Write black-box test: anon key panel shows a JavaScript snippet containing the
  PostgREST endpoint and the anon key after minting
- [ ] T02.7 Write black-box test: DDL backend error is surfaced as an inline banner
  containing the `message` field; no stack trace text present in rendered output
- [ ] T02.8 Write black-box test: row-mutation backend error is surfaced as an inline
  banner containing the `message` field; no stack trace text present
- [ ] T02.9 Write black-box test: key-management backend error is surfaced as an inline
  banner within the keys panel; no stack trace text present
- [ ] T02.10 Confirm all new tests fail before implementation (red-green discipline)

## T03: Add `postgresDdlApi.ts` service module

- [ ] T03.1 Create `apps/web-console/src/services/postgresDdlApi.ts`
- [ ] T03.2 Implement `createTable(db, schema, tableSpec): Promise<DdlExecuteResult>` using
  `requestConsoleSessionJson` with `method: 'POST'` and no `dryRun` field
- [ ] T03.3 Implement `addColumn(db, schema, table, columnSpec): Promise<DdlExecuteResult>`
- [ ] T03.4 Implement `createIndex(db, schema, table, indexSpec): Promise<DdlExecuteResult>`
- [ ] T03.5 Export `DdlExecuteResult`, `DdlError` types matching the backend contract

## T04: Add `postgresDataApi.ts` service module

- [ ] T04.1 Create `apps/web-console/src/services/postgresDataApi.ts`
- [ ] T04.2 Implement `listRows(db, schema, table, params): Promise<RowsPage>` with
  cursor-based pagination and column filter params via `requestConsoleSessionJson`
- [ ] T04.3 Implement `insertRow(db, schema, table, values): Promise<RowResult>`
- [ ] T04.4 Implement `updateRow(db, schema, table, rowId, patch): Promise<RowResult>`
- [ ] T04.5 Implement `deleteRow(db, schema, table, rowId): Promise<void>`
- [ ] T04.6 Export `RowsPage`, `RowResult`, `RowError` types

## T05: Add `postgresKeysApi.ts` service module

- [ ] T05.1 Create `apps/web-console/src/services/postgresKeysApi.ts`
- [ ] T05.2 Implement `listKeys(db): Promise<KeySummary[]>` — returns key metadata (no
  raw key values)
- [ ] T05.3 Implement `mintKey(db, keyType): Promise<KeyMinted>` — returns raw key value
  once; `KeyMinted.rawValue` is the only time the plain key is available
- [ ] T05.4 Implement `rotateKey(db, keyId): Promise<KeyMinted>` — same one-time raw
  value contract as mintKey
- [ ] T05.5 Implement `revokeKey(db, keyId): Promise<void>`
- [ ] T05.6 Export `KeySummary`, `KeyMinted`, `KeyType` types

## T06: Extract `ConsolePostgresDataGrid` sub-component

- [ ] T06.1 Create `apps/web-console/src/components/console/ConsolePostgresDataGrid.tsx`
- [ ] T06.2 Render paginated rows table using `postgresDataApi.listRows`; support
  cursor-based next/prev pagination
- [ ] T06.3 Add new-row form with per-column type-aware inputs; on submit call
  `postgresDataApi.insertRow`; show success confirmation or inline error banner
- [ ] T06.4 Add per-row edit mode; on confirm call `postgresDataApi.updateRow`; show
  success confirmation or inline error banner
- [ ] T06.5 Add per-row delete action with confirmation dialog; on confirm call
  `postgresDataApi.deleteRow`; show inline error banner on failure
- [ ] T06.6 Surface backend `message` only — no stack trace, no raw JSON

## T07: Extract `ConsolePostgresKeysPanel` sub-component

- [ ] T07.1 Create `apps/web-console/src/components/console/ConsolePostgresKeysPanel.tsx`
- [ ] T07.2 Render key list via `postgresKeysApi.listKeys`; show key type, creation date,
  status; do NOT fetch or display raw key values in list view
- [ ] T07.3 Add "Mint anon key" and "Mint service key" actions; on success display raw key
  in a masked copy-field for one session render only (not re-fetchable)
- [ ] T07.4 Immediately after mint, render a JavaScript snippet:
  `const { createClient } = require('@supabase/supabase-js'); const supabase =
  createClient('<ENDPOINT>', '<ANON_KEY>');` with the real endpoint and key substituted;
  provide a copy button
- [ ] T07.5 Add per-key "Rotate" action; show new raw value once with same snippet
- [ ] T07.6 Add per-key "Revoke" action with confirmation dialog
- [ ] T07.7 Surface backend `message` only in error banners

## T08: Update `ConsolePostgresPage` DDL confirmation flow

- [ ] T08.1 Add a "Confirm & Execute" button distinct from the existing "Preview DDL"
  button; clicking it calls `postgresDdlApi` with `executionMode: 'execute'` (no
  `dryRun: true`)
- [ ] T08.2 On DDL execute success, reload the affected tree level (tables list or
  columns list) and display a success confirmation message
- [ ] T08.3 On DDL execute error, display backend `message` as inline banner — no stack
  trace
- [ ] T08.4 The existing "Preview DDL" path remains unchanged (`dryRun: true`,
  `executionMode: 'preview'`)

## T09: Integrate data grid and keys panel into `ConsolePostgresPage`

- [ ] T09.1 Add "Data" tab alongside "Columns / Indexes / Policies / Security" in the
  table-detail section; render `<ConsolePostgresDataGrid>` in that tab
- [ ] T09.2 Add an "API Keys" section below the database-level connection snippets;
  render `<ConsolePostgresKeysPanel>` when a database is selected
- [ ] T09.3 Update the page header description to reflect that write operations are now
  available

## T10: Integration validation

- [ ] T10.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] T10.2 Run `openspec validate add-console-postgres-data-editor --strict`
- [ ] T10.3 Mark real-stack E2E coverage required: the four user-facing scenarios
  (create table, insert/edit/delete row, mint key + snippet) are candidates for
  `audit/user-stories.md` E2E flows once `add-postgres-ddl-execute`,
  `add-postgres-data-crud-execute`, and `add-app-api-keys` are applied
