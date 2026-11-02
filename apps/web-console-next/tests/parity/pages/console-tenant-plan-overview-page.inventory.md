# Mi plan parity inventory

Page: console-tenant-plan-overview-page, route /console/my-plan. Blueprint: 57f536f4-a597-4564-9c85-bc835b96e41f, SHA256 d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d. Approved page entry SHA256 e950360e0523bae5d095bbb5c75c1018f0e77b304a71948872132a074651282e. Risk R3; assigned source worktree only.

| Legacy reference | Preserved behavior or approved difference | Evidence |
| --- | --- | --- |
| apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx:36 and services/planManagementApi.ts:326-329 | One GET /v1/tenant/plan/effective-entitlements?include=consumption, no body, no tenant id, through the shared authenticated session | Page-local api.ts; Vitest and parity request assertions |
| ConsoleTenantPlanOverviewPage.tsx:39-50 | Tenantless superadmin, platform_admin and platform_operator send no request; only superadmin gets Abrir catálogo de planes (client navigation to /console/plans) | Vitest tenantless cases; parity action and error-empty |
| ConsoleTenantPlanOverviewPage.tsx:62-75 | Plan slug or muted Sin plan asignado; status-tag only when planStatus exists; no price, cycle, renewal or toggle | Vitest data; parity data |
| ConsoleTenantPlanOverviewPage.tsx:77-86 | Over-limit callout counts usageStatus over_limit, singular and plural ICU copy, hidden at zero | Vitest callout cases; parity data |
| components/console/QuotaConsumptionTable.tsx:28-53 | Five columns, Sin límite for -1 or missing, five usage labels (unknown enums fall back to Desconocido), Plan origin, Datos no disponibles for unknown usage, per-dimension accessible names | Vitest data; parity data/responsive |
| components/console/ConsumptionBar.tsx | Unlimited shows raw usage over Sin límite; null usage shows Datos no disponibles; bounded usage renders a meter whose value text reads "used de limit" plus the over-limit suffix | Vitest data |
| components/console/CapabilityStatusGrid.tsx:16 | Capabilities with Habilitada or Deshabilitada and Plan origin; empty list shows the translated No se devolvieron capacidades heredadas copy while the rest stays rendered | Vitest and parity error-empty |
| ConsoleTenantPlanOverviewPage.tsx:52 | Approved difference: 403 is a no-access empty state without retry (legacy showed an error state with the localized message) | Vitest 403; parity error-empty |
| ConsoleTenantPlanOverviewPage.tsx:52 | Approved difference: 404 is a not-found state with a link back to /console/overview | Vitest 404; parity error-empty |
| ConsoleTenantPlanOverviewPage.tsx:53 | Approved difference: skeletons replace the ConsolePageState loading card; the original loading copy is retained | Vitest loading; parity delayed response |
| ConsoleTenantPlanOverviewPage.tsx:52 | 500 and network failures render the error panel with the payload requestId (500) and a Reintentar button that keeps keyboard focus while it runs, then focuses the Mi plan heading | Vitest 500 and network; parity action/accessibility |
| packages/console-api/src/session.ts | One refresh POST on 401, one GET replay with the refreshed bearer; a rejected refresh redirects to login and stores /console/my-plan as the return intent | Vitest and parity 401 cases |
| n/a (new) | Approved difference: Resumen and Historial tabs. Historial renders an explicit empty-history state and sends no request (gap-b005-my-plan-self-history) | Vitest tabs; parity data/action/accessibility |
| ConsoleTenantPlanOverviewPage.tsx:30-35 | Approved difference: the page never keeps an earlier summary on screen while a retry is pending | Vitest retry |

The page uses the pinned kit Page, PageHeader, Tabs, DescriptionListCard, InlineCallout, DataTable, Meter, StatusTag, Badge, EmptyState, NoAccessEmpty, NotFoundEmpty, ErrorPanel and TableSkeleton. plan-card is not used (gap-b005-plan-card-no-pricing). Every kit prop is passed explicitly, including the InlineCallout actions, so no sample action or text renders. The limits table stacks as label/value cards below 768 px through page.css.

Legacy changes since the blueprint are carried forward: the session and http modules moved to packages/console-api, with no behavior change for this page. The legacy planManagementApi.ts also gained getMyPlanHistory (GET /v1/tenant/plan/history) and getPlanLifecycleHistory, but ConsoleTenantPlanOverviewPage.tsx does not call them and the approved spec keeps Historial request-free, so the new page does not call them either. Legacy source and tests remain unchanged. The approved entry has no legacy Playwright journey; the companion mirrors the legacy Vitest fixtures and adds the state fixtures named in the spec using synthetic identities.

Flipping the my-plan flag also switches the sidebar entry, the overview quick link and the allocation page back links to client navigation. The overview and allocation parity specs are updated for that, and the allocation spec switches its expectations on the flag. The browser-session registry adds only the exact GET /v1/tenant/plan/effective-entitlements?include=consumption; every other query-string request stays unmatched.

Browser parity, axe, CSP and viewport checks require PR CI because Chromium is unavailable in the maker sandbox. Visual screenshots (mixed, Historial empty, tenantless and 500 in es and en) are captured by PR CI and approved by the operator; the maker claims no visual approval.
