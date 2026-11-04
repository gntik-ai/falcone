# Migrate the console plan detail page

## Why

Issue #1261 (change request revision 3 plus the 2026-11-02 and 2026-11-04 operator decisions)
migrates `/console/plans/:planId` from the legacy console to `apps/web-console-next`. Until
then the create redirect and the catalog links land on `pendingPage`, so superadmins must use
the legacy page to manage a plan's lifecycle, deletion and per-dimension limits. The page sends
irreversible archive and delete requests to the live backend (risk R3), so lost-response
handling decides whether a request can be sent again.

Approved blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Page: `console-plan-detail-page`, wave `u2`, entry SHA256
`62fd836d9a05d5d66768330b22a174dd9fed27d130862493d82314fcaaf21ed0`.

## What changes

- Add the lazy superadmin-guarded dispatch for `plans/:planId` in `src/router.tsx` and set
  `migrated: true` in `src/shell/routes.ts`. Reverting those two lines renders `pendingPage`
  with no plan request.
- Compose the resource-detail layout from the pinned gntik-ui 0.11.0 kit with explicit props,
  kit tokens and the `pages.console-plan-detail-page` es/en catalogs: page-header (status tag,
  slug, h1), stepper, tabs (Informacion, Capacidades, Limites, Asignaciones), description-list
  card, a status-timeline with exactly one entry, status tags, a data-table with
  `paginated={false}` and number inputs.
- Send the legacy requests through `packages/console-api`, field for field: GET plan and GET
  limits in parallel, POST lifecycle `{targetStatus}`, DELETE plan, PUT limit `{value}` and
  DELETE limit, each followed by the legacy reload.
- Lifecycle POST and plan DELETE are non-idempotent writes: after a 401 they refresh the session
  once and are never sent again by the transport. Only Reintentar sends them again.
- Confirmations use a composed AlertDialog whose copy, including the type-to-confirm
  instruction, comes from the page catalog. Eliminar and Archivar require the plan
  `displayName`; Marcar como obsoleto and Restablecer use a destructive alert dialog; Activar
  has none.
- Failure states: mutation 403 renders no-access and disables every mutation control; 5xx and
  network failures render an error-panel with the status code, request id and localized copy and
  Reintentar re-sends the identical request in the open dialog, above the tabs (Activar) or under
  the table (Guardar). A lost lifecycle response shows outcome-unknown copy. Backend text never
  renders; known business codes use localized copy.
- Add page, routing, rollback and mocked parity coverage. Shared fixture registries gain only
  this page's two reads (`GET /v1/plans/{id}` and `GET /v1/plans/{id}/limits`): the shared
  browser-session fixture (`sample-planId`), `tests/consolePlanCreate.test.tsx` and
  `tests/parity/pages/consolePlanCreate.manifest.ts` (`p1`).

## Accepted parity changes

- No lifecycle-history fetch: the flag-gated `GET /v1/plans/{id}/lifecycle-history` added to the
  legacy page by `35f0e3ac` is not made (operator scope change, 2026-11-04). The status timeline
  shows exactly one entry, the current status at `updatedAt`, and never infers past transitions.
- Typed-name archive confirmation: Archivar requires the plan `displayName`, strengthening the
  legacy WARNING dialog.
- After a failed limit save or reset the row returns to the loaded profile without an extra
  limits GET.

## Routing and serving

The page counts as routed on main through `apps/control-plane/route-map.runtime.json` (unchanged)
and the chart's `/next` wildcard (`values.yaml` console `/*` and `public-api-plans` `/v1/plans/*`,
`static-server.mjs:118`). This change closes `gap-falcone-plans-quotas-unpublished` for this page.
There is no chart, gateway or backend diff.

## Fixture files touched

- `apps/web-console-next/tests/browser-session.mjs`
- `apps/web-console-next/tests/consolePlanCreate.test.tsx`
- `apps/web-console-next/tests/parity/pages/consolePlanCreate.manifest.ts`

Only the two plan-detail reads were added; no existing assertion changed.
