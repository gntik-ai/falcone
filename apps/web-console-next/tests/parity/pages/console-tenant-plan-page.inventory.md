# Tenant plan migration evidence

- Page: `console-tenant-plan-page`, `/console/tenants/:tenantId/plan`, wave u2, issue #1265, risk R3.
- Blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
- Approved canonical page entry SHA256: `b2699ac71765f70908c2deba1474902eec406aa5870d22710e1f25cfec698a2b` (control-plane input).
- Offline Hermes kit snapshot SHA256: `6f420b06bdf3b29544b4412b17deb8fb24870eb5b7aa729460bc57faa6bc66c5`. UI, blocks and templates stay pinned to `0.11.0` and tokens to `0.3.0`; no manifest or lockfile changed.

## Request parity and legacy changes

`src/pages/consoleTenantPlan/api.ts` mirrors the legacy `planManagementApi.ts` calls field for field (lines 290-299, 313, 314, 326-329, 342-343):

| Action | Request |
| --- | --- |
| Assignment | GET `/v1/tenants/{id}/plan` |
| Entitlements | GET `/v1/tenants/{id}/plan/effective-entitlements?include=consumption` |
| History | GET `/v1/tenants/{id}/plan/history-impact?page=N&pageSize=20` |
| Active plans | GET `/v1/plans?status=active&page=1&pageSize=20` |
| Assign | POST `/v1/tenants/{id}/plan`, body `{ planId, assignedBy: 'console' }` |

A unit test runs the legacy client and the migrated client against the same fetch recorder and compares method, URL and body. The tenant id is not encoded, as in the legacy client.

The legacy diff from `fecb3a03` to `1e41f8dc` for this page's closure only moves the shared transport into `@in-falcone/console-api` (deleting `lib/http.ts`, changing one comment in `console-errors.ts`) and adds `getMyPlanHistory` and `getPlanLifecycleHistory` to `planManagementApi.ts`. This page calls neither, so no behaviour, validation, state or copy changed for it, and nothing needed carrying over.

## Approved behaviour changes

- Resumen renders only when both the assignment and the entitlements succeed. Either failure replaces the summary with the page error surface, and `Reintentar` re-requests both (legacy swallowed the history and catalogue errors and showed a blocking error for the first two only).
- History is server paginated at 20 with a footer hidden at 20 or fewer; history and catalogue failures render in their own scope (Historial, the dialog) with the status-specific recovery from the issue.
- A successful assignment refetches the assignment and entitlements and announces the result (legacy only closed the dialog). The legacy assignment failure was an unhandled rejection; it now renders in the dialog.
- The assignment POST never replays. `assignPlan` authenticates once and, on a 401, refreshes the session and reports it instead of sending the POST again (the shared transport would replay). After a network error `Reintentar` re-reads the plan first and sends no POST when the selected plan is already current; a failed re-read keeps the outcome unknown, so the next `Reintentar` re-reads again.
- The dialog default selection is the current plan when it is still active, otherwise the first active plan.
- The select's accessible name is the visible label `Plan activo`: the kit `Field` labels the control with `aria-labelledby`, which takes precedence over the legacy `aria-label`.

## Kit composition and localization

`resource-detail` is composed from `Page`, `PageHeader`, `Tabs`, `DescriptionListCard`, `DataTable`, `StatusTimeline`, `Collapsible`, `Dialog`, `Field`, `SimpleSelect`, `Meter`, `StatusTag`, `Timestamp`, the empty and error blocks, and the skeleton blocks. Every data and action slot is passed explicitly. `plan-card` is not used (gap-b005-plan-card-no-pricing).

- `PaginationFooter` always renders a rows-per-page select, which a fixed page size of 20 does not need, so the documented fallback of gap-kit-builtin-copy-english is used: `Pagination` plus a `Text` summary, with every name translated.
- `StatusTimeline` cannot host a disclosure inside an event, so each history entry renders one single-event timeline followed by its `Collapsible`.
- The primary action is a `Button` below the header instead of a `PageHeader` action, because header actions cannot carry `aria-busy` or return focus.
- Retry buttons follow the allocation page pattern: the `ErrorPanel` has no retry of its own and a `Button` with `aria-disabled` keeps keyboard focus while a retry runs.

## Tests and review boundaries

Vitest covers rendering in es and en, the four-read load, the all-or-nothing summary, every history, catalogue and assignment failure, POST counts for each failure mode, permission denial, the legacy request parity and the CSP exact-pair allowance. Rollback tests cover the route flag.

The Playwright spec (`console-tenant-plan-page.spec.mjs`) serves the plan paths from one page-local route that reads the method and query, keeps per-request sequences, and records anything outside the approved list. It covers es and en at 375, 768 and 1280 pixels, including axe, focus, runtime health and the visual states required by the visual-review criterion: both tabs, an expanded entry with the footer, the Historial error, the dialog with its catalogue error, its assignment not-found and error states, and the page error. SHA256-labelled screenshots are attached for the checker and the operator.

Chromium is unavailable in the maker sandbox; PR CI runs browser parity, axe, responsive, visual and CSP checks. Screenshot artifacts still require the independent checker's assessment and operator approval; no visual approval is claimed here. The offline kit MCP server is unavailable to the maker, so `validate_page` is NOT_RUN; the repository colour and i18n checks run instead.

## Open points

- `history-impact` and `effective-entitlements` are in `route-map.json` but not in `deploy/gateway-config/public-route-catalog.json`; behind the gateway they may fail at runtime (gap-falcone-plans-quotas-unpublished). This change does not touch the gateway.
- The kill switch is the route flag (`routes.ts`) together with the `migrated` check in `router.tsx`; reverting the single commit restores `Página pendiente`.
