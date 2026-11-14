# Migrate the PostgreSQL data editor to the next console

Migrate `/console/postgres/data` for issue #1294, blueprint
`57f536f4-a597-4564-9c85-bc835b96e41f`, blueprint SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`, page entry SHA256
`ad34f399ff5744b15aad283c922ff8bcb7f3912f50aa7339786514b9d3f40ddd`, wave u3.
The assigned source base is `2cb8214bb5c3f9b2c2b6019c904ee1cfc236fa30`.

The page ports the legacy row editor and API-key panel with gntik-ui 0.12.0 and
tokens 0.4.0 (the pins already in `apps/web-console-next/package.json`; no kit
version change). It keeps the 14 actions, the 7 validations and the permission
guards, adds a typed confirmation to row delete and key revoke, and reveals an
issued key once, masked.

## Requests

Only these requests are sent, through `packages/console-api`, with the legacy
method, path, query and payload: `GET`/`POST` rows, `PATCH` and `DELETE`
`rows/by-primary-key?id=`, `GET`/`POST` `api-keys`, `DELETE` `api-keys/{id}`, and
the preview `GET` rows. The legacy page never calls DDL, exports, imports, bulk
insert or key rotation, so they are not ported. The preview sends `apikey` and no
`Authorization` header, keeps `Accept`, `Content-Type`, `X-API-Version` and
`X-Correlation-Id` from `requestJson`, and never refreshes the console session.

## Guards found by the first campaign

- A pending insert, edit or delete keeps its controls disabled across database,
  schema and table changes. The busy flag is held by the page, above the editor,
  so the editor neither remounts nor resets it. A settled mutation reloads only
  the target it started on.
- While a save is pending the drawer refuses Cancelar, Escape and outside clicks.
  Browser assertions on the controls behind the modal drawer use `includeHidden`.
- Each parity action scenario resets the recorded requests and asserts only its
  own writes.
- Every workspace-loading error, 403 included, keeps Reintentar.
- The `schema.table` heading and fixture cells are marked as data for the locale
  check, so they are not classified as raw translation keys.
- Journeys that inject 401, 403, 404, 500 and network failures register them as
  expected diagnostics; runtime health stays strict for everything else.

## Secrets

An issued key lives only in the reveal dialog's props and state. It is never
written to storage, a toast, a live region or a log, and it is dropped when a new
key is issued, when the dialog closes or when the page unmounts. Fixtures use
synthetic keys. Screenshots mask the key field and the snippets.

## Test changes

`tests/overview-shell.test.tsx` gains the `isMigratedRoute('/console/postgres/data')`
assertion. `tests/consolePostgres-routing.test.tsx` already asserted that this
route was not migrated; setting the route flag makes that line `true`, and it is
the only edit to that file. No other existing test changes.

## Rollout and rollback

Offline kit reference: Hermes snapshot
`e34e5d590fd4a6749a02011cb685cce4a1945124e538af0145c66e9e1be4c96b`. MCP is not
configured, so `validate_page` is NOT_RUN; the colour and i18n lints cover the
page sources. Chromium is unavailable in the maker sandbox, so browser parity,
axe and viewport runs happen in PR CI. Screenshot assessment and baseline
approval happen in the PR CI visual-review journey and at operator approval.

The route flag is the rollback switch: remove `migrated: true` from the
`postgres/data` entry in `apps/web-console-next/src/shell/routes.ts` and the
navigation falls back to the legacy page. The legacy console, backend, shared
contracts, dependencies and the deployment repository are unchanged. Every
endpoint is gateway-only; the page stays under `/next/` and is not enabled for
real tenants until `gap-falcone-gateway-only` closes. This R3 source change
grants no merge, deployment or approval authority.
