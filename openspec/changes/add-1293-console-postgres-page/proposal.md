# Migrate the PostgreSQL inventory to the next console

Migrate `/console/postgres` for issue #1293, blueprint
`57f536f4-a597-4564-9c85-bc835b96e41f`, blueprint SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`,
page entry SHA256 `25577e183bb08ffc7e19fb9eaae279008c6ffa1ec4d0e93d93a5d4b618cf897d`.
The assigned source base is `30bdbe3392670f73ba17b1ad9a45288e8686d0f8`.

The resource-index composition uses the pinned gntik-ui 0.12.0 and tokens 0.4.0,
with explicit data and labels and Spanish/English page catalogs. Tables disable
client paging, sorting and column/density menus. Separate cursor stacks preserve
the exact first-page query and add only the approved next cursor.

The hierarchy retains the database/schema/table drilldown, connection templates,
read-only detail tabs, section-local failures and DDL previews. Security reads
have no query. Each dry-run PUT retains every legacy payload field, including
optional view configuration. The wizard checks tenant metrics before workspace
metrics even when permission is denied. It validates the trimmed name and submits
the original name, extensions and collections with the legacy request ID and
idempotency handling. Session refresh and replay remain owned by console-api.

The supplied legacy changes are carried through the current shared API and
permission/session foundation. This page uses the shell's combined loading/error
fields in its workspace gate, which only mounts with an already selected database
and active tenant; no new context or API surface is introduced.

`pendingRouteElement(guard?)` preserves the pending route rendering and replaces
the borrowed PostgreSQL element in the three rollback tests. Existing strict-log
journeys need empty first-render reads in exactly these files:

- `tests/consoleWorkspaceDatabase-routing.test.tsx`, sidebar arrival only.
- `tests/parity/pages/console-workspace-database-page.support.mjs`, without logging
  the PostgreSQL read as a database-page request.

The other PostgreSQL references only inspect hrefs or stub the destination document.
The CSP session has no tenants; `tests/browser-session.mjs` requires no change.
The overview-shell test gains only the migrated PostgreSQL assertion.

Offline kit reference: Hermes snapshot
`10ec8aeceb7cb61fb957ad537cef3d8c2c0d31b79050c37b76201371d97dbc15`.
MCP is not configured, so validate_page is NOT_RUN; local colour and i18n checks
cover the page sources. Browser parity is next-build only. Chromium is unavailable
in this maker sandbox; PR CI runs parity, axe, CSP and viewport checks. Screenshot
artifacts require the independent checker's assessment and operator approval.

The route flag is the rollback switch; `postgres/data` remains pending. The legacy
console, shared contracts, backend, dependencies and deployment repository are
unchanged. Gateway-only DDL and unpublished database-create gap blockers remain
merge gates. This R3 source change grants no merge, deployment or approval authority.
