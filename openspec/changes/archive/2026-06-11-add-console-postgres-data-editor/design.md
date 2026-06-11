## Context

`apps/web-console/src/pages/ConsolePostgresPage.tsx` is a 1596-line React component
that today is entirely read-only. All mutation calls pass `dryRun: true` and
`executionMode: 'preview'` (lines 505-519, 527-569). The component uses
`requestConsoleSessionJson` from `src/lib/console-session.ts` directly for every API
call rather than going through a service layer. There are no calls to row-CRUD
(`/rows`) or app-api-key endpoints anywhere in the console.

This change adds three write surfaces to the page and introduces the service-layer
modules that should have been present from the start.

## Goals / Non-Goals

**Goals:**
- Replace `executionMode: 'preview'` with `executionMode: 'execute'` on confirmed DDL
  operations (CREATE TABLE, ADD COLUMN, CREATE INDEX) in `ConsolePostgresPage`.
- Add a data grid tab on the selected-table view backed by the `postgresDataApi.ts`
  service module supporting paginated list, insert, update, and delete rows.
- Add an API-keys panel (in-page section or nested within the database view) backed by
  `postgresKeysApi.ts` that mints/rotates/revokes anon and service keys and renders a
  frontend JavaScript snippet once a key is minted.
- Add `postgresDdlApi.ts`, `postgresDataApi.ts`, `postgresKeysApi.ts` under
  `apps/web-console/src/services/` to wrap the three backend families.
- Surface backend `message` fields as inline error banners; never render stack traces
  or raw JSON bodies to users.

**Non-Goals:**
- Implementing the backend DDL-execute, data-CRUD, or app-api-keys endpoints (those
  are `add-postgres-ddl-execute`, `add-postgres-data-crud-execute`, `add-app-api-keys`).
- Adding SQL query execution (ad-hoc SQL editor) — that is a separate capability.
- Realtime / subscription wiring for row-level changes — deferred per locked decision.
- Policy or RLS editing UI — read-only display of policies is already present.

## Decisions

**D1 — Service module per API family.**
Rationale: `ConsolePostgresPage` currently bypasses a service layer and calls
`requestConsoleSessionJson` directly with inline URL strings. Adding 60+ more direct
calls for data/DDL/keys would make the component unmaintainable. Three thin modules
give the page a stable interface and allow unit tests to mock at the service boundary.

**D2 — Show the raw anon-key value exactly once, then never again.**
Rationale: Supabase-compatible anon keys are long-lived bearer tokens. Persisting them
in the console session or making them re-retrievable would widen the secret-leakage
surface. Showing the value once on mint (and on rotate) matches the established
pattern for service-account credentials in `ConsoleServiceAccountsPage`.

**D3 — Inline error banners surface `message` only.**
Rationale: `apps/web-console/src/lib/http.ts::normalizeApiError` (lines 77-94)
already extracts `message` from the API error payload. `ConsolePostgresPage` uses
`getApiErrorMessage` (lines 182-197) for the same purpose. All three new surfaces
follow the same pattern — no raw body, no `detail`, no stack trace.

**D4 — Execute DDL only after explicit user confirmation.**
Rationale: DDL on a production database is potentially destructive. The existing
preview flow already shows a risk profile and warnings. The execute path must require
a distinct user confirmation step (a button separate from the preview request) to
prevent accidental execution.

**D5 — Pagination and filtering for the row data grid via query-string params.**
Rationale: The existing page-query helper (`createPageQuery`, line 203) already
constructs `page[size]=100` params. The data grid extends this with `page[cursor]` for
cursor-based pagination and `filter[<column>]` params aligned with the data-CRUD API
family contract.

## Risks / Trade-offs

**Risk: ConsolePostgresPage is already 1596 lines; adding data grid + keys panel
will push it well past maintainability thresholds.**
Mitigation: Extract data-grid and API-keys panel into separate sub-components
(`ConsolePostgresDataGrid`, `ConsolePostgresKeysPanel`) so the parent page remains
a composition root.

**Risk: The row data grid displays raw database values including potential PII.**
Mitigation: This is the same risk that exists for any BaaS console data browser.
The console is protected behind authentication and the tenant-scoped session. No
additional PII masking is in scope for this change.

**Risk: DDL execution is irreversible (DROP, ALTER may not be recoverable).**
Mitigation: This change only enables CREATE TABLE, ADD COLUMN, CREATE INDEX via the
execute path. Destructive DDL (DROP, TRUNCATE, ALTER…DROP COLUMN) is not surfaced in
the UI in this iteration.

## Migration Plan

1. Add `apps/web-console/src/services/postgresDdlApi.ts` — typed wrapper for DDL
   execute endpoints.
2. Add `apps/web-console/src/services/postgresDataApi.ts` — typed wrapper for row
   CRUD endpoints.
3. Add `apps/web-console/src/services/postgresKeysApi.ts` — typed wrapper for
   app-api-keys endpoints.
4. Extract `ConsolePostgresDataGrid` sub-component; connect to `postgresDataApi`.
5. Extract `ConsolePostgresKeysPanel` sub-component; connect to `postgresKeysApi`;
   implement one-time key display and snippet rendering.
6. Update `ConsolePostgresPage` DDL confirmation flow to call `postgresDdlApi`
   `execute` mode; remove `dryRun: true` from confirmation path.
7. Run `bash tests/blackbox/run.sh` to confirm no regressions.
