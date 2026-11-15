# Migrate the MongoDB data editor to the next console

Migrate `/console/mongo/data` (document editor and anonymous-key embed) for issue #1295, blueprint
`57f536f4-a597-4564-9c85-bc835b96e41f`, blueprint SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`, page entry SHA256
`a87a837e7e4ef01e049444e7f755d1262b34fe0782ef02fdced57ab22743ce4a`. The assigned source base is
`0bdacb1864340357ec1a63cb275a8edcf10ef7d8`.

## Why

The route is still unmigrated in `apps/web-console-next` (`src/shell/routes.ts`). The page deletes documents and issues
an anonymous API key that is shown once. Neither can be undone, so the change is R3. Legacy deletes with no
confirmation; the next page requires the document `_id` to be typed first. The legacy page stays the default and the
next page is served only under `/next/`.

Where the continued requirements of the issue conflict with the issue's own Why section, the Why section wins. The kit
pin is the one already in `package.json` (ui, blocks and templates 0.12.0, tokens 0.4.0); no kit version changes. The
legacy changes since the blueprint (the `@in-falcone/console-api` import moves and the import-mode additions to
`mongoApi.ts`) alter no behaviour of this page.

## What changes

- New page module `apps/web-console-next/src/pages/consoleMongoData/` (page, client, i18n under
  `pages.console-mongo-data-page`), lazily registered in `src/router.tsx`; `migrated: true` on the `mongo/data` entry of
  `src/shell/routes.ts`.
- Page composition: page-header, a form-section for database and collection, page-toolbar with the JSON filter,
  data-table (`paginated={false}`) with a json viewer per document and Editar / Eliminar, a select and two buttons for the
  cursor pager, insert form-section, edit drawer, a typed-id delete confirmation, an anonymous-key reveal dialog
  (secret field, shown-once alert, fetch and curl snippets, read-only preview), empty-states, skeletons, error-panel and
  inline-callout. Every prop is passed explicitly.
- The delete confirmation composes the kit alert dialog with catalog copy, because the kit confirm-destructive block
  hard-codes English type-to-confirm copy (gap-kit-builtin-copy-english) and has no request id or assertive
  announcement. A failed DELETE keeps it open with the error, the request id, the typed id and focus inside.
- Requests: `GET .../documents` with `page[size]`, `page[after]` and a JSON `filter` only when non-empty, `POST
  .../documents {document}`, `PATCH .../documents/{id} {update}` without `_id` or `id`, `DELETE .../documents/{id}`,
  `POST /v1/workspaces/{ws}/api-keys {keyType:'anon'}` and the apikey preview `GET .../documents?page[size]=10`, plus shell
  bootstrap and the refresh POST. Postgres, import, export, PUT replace and api-key list, delete or rotate are never sent.
- The busy flag lives in the page above the editor, so changing database or collection cannot remount the editor into a
  non-busy state. The pager is keyed by target and reset on every change.
- Tests: Vitest ports of the legacy page tests (including the #742 workspace-required cases) and of the form-control
  legibility case, with a strict request allowlist; parity files `tests/parity/pages/console-mongo-data-page.*`.
- Existing tests: `tests/overview-shell.test.tsx` gains the assertion that `/console/mongo/data` is migrated.

## Out of scope

Backend or gateway work (gap-falcone-gateway-only), PostgreSQL editing, Mongo import, export and replace, API-key list,
revoke and rotate UI, new kit components, kit version changes, deleting the legacy page (u5 cutover), harness files and
the deployment repository.

## Risks, rollout and kill switch

Document delete and key issue are irreversible. The issued key lives only in component memory: never in storage, logs,
toasts, announcements or baselines, and it is dropped when the reveal closes and on unmount. Fixtures use a placeholder
key. Keys issued against real environments have no revoke UI here. Kill switch: remove `migrated: true` from the
`mongo/data` entry; navigation falls back to the legacy anchor.

## Open questions

- Should anonymous keys issued during parity or CI runs against real environments be revoked by a separate process?
- The issue cites `router.tsx:331` for the legacy guard while the route is at `:333`.
