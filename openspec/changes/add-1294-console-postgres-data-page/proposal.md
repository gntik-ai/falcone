# Migrate the PostgreSQL data editor to the next console

Migrate `/console/postgres/data` (row editor and API-key panel) for issue #1294, blueprint
`57f536f4-a597-4564-9c85-bc835b96e41f`, blueprint SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`, page entry SHA256
`ad34f399ff5744b15aad283c922ff8bcb7f3912f50aa7339786514b9d3f40ddd`. The assigned source base is
`2cb8214bb5c3f9b2c2b6019c904ee1cfc236fa30`.

## Why

The route is still unmigrated in `apps/web-console-next` (`src/shell/routes.ts`). The page deletes rows,
issues and revokes API keys and shows a revealed secret in the browser. None of these can be undone through
inventoried endpoints, so the change is R3. The legacy page stays the default and the next page is served
only under `/next/`.

Where the continued requirements of the issue conflict with the issue's own Why section, the Why section wins.
Only these clauses are superseded: the preview clause "(apikey header only, page size 10)", the
workspace-required clauses "and sends no request" / "no /v1 request", the whole error-401 clause, the endpoint
list in "Keep the API calls identical", and the drawer clause of the accessibility criterion, which now holds
only when no mutation is in flight. The kit pin is the one already in `package.json` (ui, blocks and templates
0.12.0, tokens 0.4.0); no kit version changes.

## What changes

- New page module `apps/web-console-next/src/pages/consolePostgresData/` (page, client, i18n under
  `pages.console-postgres-data-page`), lazily registered in `src/router.tsx`; `migrated: true` on the
  `postgres/data` entry of `src/shell/routes.ts`.
- Page composition: resource-index layout with page-header, page-toolbar (database, schema, table), filter
  composite, data-table with cursor pager, insert form-section, edit drawer, API-key panel with a reveal dialog
  (secret-field, shown-once alert, snippets, read-only preview), type-to-confirm dialogs for row delete and key
  revoke, empty-states, skeletons, error-panel and inline-callout. Every prop is passed explicitly.
- Requests: GET/POST `rows`, PATCH and DELETE `rows/by-primary-key?id=`, GET/POST `api-keys`, DELETE
  `api-keys/{id}` and the apikey preview GET `rows?page[size]=10`, plus shell bootstrap and the refresh POST.
  DDL, exports, imports, bulk insert and rotations are never sent.
- The busy flag lives in the page above the editor, so changing database, schema or table cannot remount the
  editor into a non-busy state. Mutations capture their target when they start.
- Every effect-driven rows reload also reloads the API keys, as legacy does. The pager is keyed by target and
  reset on every change, so a revisited target starts at its first page.
- Tests: Vitest ports of the legacy page tests (including the #742 cases) and of the form-control legibility case;
  a strict fetch allowlist; parity files `tests/parity/pages/console-postgres-data-page.*` with the fixtures.
- Existing tests: `tests/overview-shell.test.tsx` gains the assertion that `/console/postgres/data` is migrated,
  and `tests/consolePostgres-routing.test.tsx` flips only its `postgres/data` assertion from false to true.

## Out of scope

Backend or gateway work (gap-falcone-gateway-only), UI for DDL, export, import, bulk insert and key rotation, new kit
components, kit version changes, deleting the legacy page (u5 cutover), and the deployment repository.

## Risks, rollout and kill switch

Row delete, key revoke and key issue are irreversible. Issued keys live only in component memory: never in storage,
logs, toasts or baselines, and they are dropped on the next issue, when the reveal closes and on unmount. Fixtures use
placeholder keys. All endpoints are GATEWAY_ONLY, so the page cannot be shown to work end to end until
gap-falcone-gateway-only closes. Kill switch: remove `migrated: true` from the `postgres/data` entry; navigation falls
back to the legacy anchor.

## Open question

A 401 on the apikey preview carries no session token, so it skips the session refresh and shows its error inline.
