# Migrate the console observability page

## Why

Issue #1260 (change request revision 3 plus the 2026-11-02 visual-review amendment) migrates
`/console/observability` from the legacy console to `apps/web-console-next`. The route is still
`pendingPage`, yet it is the landing for read-only roles (`src/shell/guards.tsx`,
`src/pages/login.tsx`). The page shows metric dimensions with quota posture, the workspace
`api_requests` series and a filtered audit trail with a JSON manifest export. Stale or cross-scope
audit state is the main hazard (risk R3, assigned by the control plane).

Approved blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Page: `console-observability-page`, wave `u2`, entry SHA256
`ea38e3cc639380ab454ab25cc689a4951e4db2d7221f7b6dfbe5ce51310abcaa`.

## What changes

- Set `migrated: true` for `observability` in `src/shell/routes.ts` and add one lazy dispatch in
  `src/router.tsx`. Reverting those two lines renders `pendingPage` with no metrics or audit request.
- Add the page under `src/pages/consoleObservability` with the `pages.console-observability-page`
  es/en catalogs, composed from the pinned gntik-ui 0.11.0 kit with explicit props: page-header
  (context line, quota posture status-tag linking to `/console/quotas`, kit tabs), page-toolbar,
  one chart-card series surface with its range toggle hidden, a meter per dimension, data-table with
  `paginated={false}` plus load-more-footer, two independent date-picker fields for Desde and Hasta, a detail drawer with
  description-list-card and json-viewer, inline-callout, empty-states, skeletons and error-panel.
- Add a page-local request module on `requestConsoleSessionJson` for the nine listed endpoints only:
  GET `tenants/{}/overview`, `usage`, `audit-records`; POST `tenants/{}/audit-exports`; GET
  `workspaces/{}/overview`, `usage`, `series`, `audit-records`; POST `workspaces/{}/audit-exports`.
  `GET tenants/{}/series` is never sent. Overview and usage carry no query string; only the workspace
  series carries `metricKey=api_requests&window=<w>`.
- The audit trail asks for `page[size]=50&sort=-eventTimestamp` and the legacy `filter[...]`
  parameters. `Cargar mas` sends `page[after]=<nextCursor>` with the same filters and appends.
- Every audit page, cursor, drawer, export state and retry state is keyed to its tenant, workspace
  and filters with a generation counter. A response for a superseded scope or filter set is neither
  rendered nor appended. The export body is frozen when it is posted, and `Reintentar` re-posts that
  body to the scope that failed.
- Carry the legacy changes since the blueprint: dimensions whose policy mode is `not_enforced` show
  the `Cuota no aplicada` badge (22072f17), and the shared console-api session and permission
  modules replace the local ones.
- Update `tests/shell.test.tsx` so `platform_auditor` without a tenant expects
  `Observabilidad bloqueada`, and register this page's reads additively in `overview.spec.mjs` and
  the login-page manifest, which land read-only roles here.

## Out of scope

- Backend, gateway or route-catalog changes, including the audit cursor and export-filter gaps.
- Any `gntik-ai/falcone-charts` change: `/v1/metrics/*` is already routed.
- Kit additions or version bumps, spend chart and CSV breakdown slots, a 90d option.
- Editing or deleting the legacy page (u5 cutover) and u0-owned parity infrastructure.

## Known backend gaps

- `audit-records` always returns `hasMore: false` and `nextCursor: null` and ignores `page[after]`
  and `sort`, so `Cargar mas` is exercised only by fixtures until the backend pages by cursor, and
  the legacy 50-record cap note is gone.
- `audit-exports` ignores the body filters, so a filtered export returns unfiltered records in
  scope. The page still sends the filters, as the legacy page does.
- The UI gate is not a security boundary: the handler checks tenant ownership, not
  `tenant.audit.read`.

## Rollback

Revert the route flag and the router line. No data, secret or chart rollback applies.
