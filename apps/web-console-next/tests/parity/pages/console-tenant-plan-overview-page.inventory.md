# My plan migration evidence

Page: console-tenant-plan-overview-page, blueprint 57f536f4-a597-4564-9c85-bc835b96e41f.
Blueprint SHA256: d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d.
Approved page entry SHA256: e950360e0523bae5d095bbb5c75c1018f0e77b304a71948872132a074651282e.
Delivery base: 9c477e46b20ceb0a28c56d63d0f738e886580813, assigned branch agent/falcone/1267/07dd493a-9692-5a60-968e-0c4e5bc311ec.

| Legacy source | Preserved behavior | Evidence |
| --- | --- | --- |
| ConsoleTenantPlanOverviewPage.tsx:36; planManagementApi.ts:262-273,326-329 | Only GET /v1/tenant/plan/effective-entitlements?include=consumption, no body; shared session transport and refresh | Vitest direct legacy/new request comparison, strict unmatched-request check, 401 refresh and login intent; parity exact request assertions |
| ConsoleTenantPlanOverviewPage.tsx:39-50 | Tenantless platform roles make no page request; only superadmin gets catalogue action | Vitest permissions and catalogue heading focus; parity named tenantless fixtures |
| ConsoleTenantPlanOverviewPage.tsx:63-90 | Slug/fallback, conditional plan status, over-limit singular/plural count, empty quotas | Vitest summary, absent plan and count tests; parity mixed/empty data |
| QuotaConsumptionTable.tsx:28-53; ConsumptionBar.tsx:48-109 | Five usage labels, unlimited/missing limits, unknown consumption, raw over-limit usage, breach marker, dimension-specific accessible names | Vitest bilingual data and zero-limit tests; parity data, accessibility and mobile stacked rows |
| CapabilityStatusGrid.tsx:16-42 | Enabled/disabled, accessible capability names, Plan origin, empty-capabilities copy without hiding the rest | Vitest data and empty-capabilities tests; parity mixed and no-capabilities fixtures |
| ConsolePageState.tsx; shared session transport | Skeleton loading; approved 403/404 empty states; retryable 500/network with request ID and no stale summary | Vitest loading, errors and focus tests; parity delayed/error fixtures |

Resource-detail is composed with kit Page, PageHeader, Tabs, DescriptionListCard, InlineCallout, DataTable, Meter, StatusTag, Badge, EmptyState, NoAccessEmpty, NotFoundEmpty, ErrorPanel and TableSkeleton. Template data slots are supplied explicitly through the composition; no template sample data or plan-card billing fields render. The history region uses the approved empty state instead of fabricated status-timeline entries, and makes no request. DataTable is unpaginated, has no selection, density, column, pin or view menus, and has explicit rows, columns, labels and empty/loading slots. At mobile width its five columns become labelled stacked rows. Capability fields use the kit's one-column mobile/three-column desktop description list.

Both catalogs supply every visible and accessible label. All shell auth/context logic is reused. The router branch checks route.migrated, with no new guard; rollback tests cover pendingPage, navigation anchors and the overview quick card under /next/. Allocation remains migrated as it was on the delivery base.

All legacy changes since the blueprint are carried forward: session/http extraction uses packages/console-api/session. The newly added token-scoped history and lifecycle methods in the legacy service are outside this page's request closure and are not called. No legacy source or test is changed. The approved entry has no legacy Playwright journey; the companion mirrors its synthetic Vitest fixtures and adds the blueprint's states and bilingual viewport checks.

## Existing parity specs touched by the My plan allowance

- overview.spec.mjs: the My plan quick card has a router-basename href and reaches the migrated page; register its GET. overview.tsx:47 remains unchanged; the card may perform a document load.
- console-tenant-allocation-summary-page.spec.mjs: the My plan back action becomes router navigation, its href includes the basename, and register the destination GET. The existing runtime journey now reaches the real page.
- console-workspace-dashboard-page.spec.mjs: 403/404 My plan actions use the router-basename href; register the destination GET. Its page and unit tests remain untouched.

The new runtime-health check verifies the same-document marker from allocation and from the visible navigation landmark (opening the drawer at 375 px). From the overview card it verifies URL, heading, quota table and runtime health only, per the operator decision. The visual spec captures mixed summary, mixed history, shell-superadmin-tenantless and my-plan-entitlements-500 in es/en at 375/768/1280. Synthetic fixtures contain no real tenant data.

The Hermes offline snapshot pins gntik-ui 0.11.0 and tokens 0.3.0. No MCP server is configured, so validate_page is NOT_RUN; local colour and i18n linters cover the page. Chromium is unavailable in this sandbox: browser parity, axe, CSP, responsive and visual checks run in PR CI under both basenames. Baseline review occurs after publication with operator approval; no screenshot approval is claimed here.
