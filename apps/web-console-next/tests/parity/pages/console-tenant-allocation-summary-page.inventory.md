# Allocation summary parity inventory

Page: console-tenant-allocation-summary-page. Blueprint: 57f536f4-a597-4564-9c85-bc835b96e41f, SHA256 d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d. Approved page SHA256 ca90b6a2669689c37eb2b17aa22c2fc7a7aedd06fdc8cec19edef32d379fa4b4. Risk R1; assigned source worktree only.

| Legacy reference | Preserved behavior or approved difference | Evidence |
| --- | --- | --- |
| apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx:18-25 | Tenantless platform roles skip the request; otherwise one GET on load or retry | Vitest tenantless cases and request assertions; parity data/action/error-empty |
| apps/web-console/src/services/planManagementApi.ts:263-276,339-340 | GET /v1/tenant/plan/allocation-summary with no query or body through shared authenticated session | Page-local api.ts; Vitest and parity request and refresh assertions |
| packages/console-api/src/session.ts:256-264 | One refresh POST on 401, one GET replay with refreshed bearer; rejected refresh redirects to login, storing return intent | Vitest and parity action/error-empty |
| apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx:31-85 | Five columns, one row per dimension, shared pool and fully allocated badge, no pagination, stacked mobile labels | Vitest data; parity data/responsive |
| apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx:89-114 | Unlimited, null unallocated, byte detection and label fallback preserved; values use Intl in active locale as approved | Vitest formatting/precedence and bilingual data; parity data |
| apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx:59-67 | All dimensions without workspaces use empty state instead of table | Vitest loading/empty; parity error-empty |
| apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx:39-49 | Approved difference: 403 no-access without retry, 404 not-found with My plan link, 500/network ErrorPanel with retry. Only payload requestId is displayed; correlationId is never displayed | Vitest 403/404, network and retry; parity error-empty |
| apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx:50-58 | Approved difference: TableSkeleton replaces legacy loading card; original loading copy retained | Vitest loading; parity delayed response |
| apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx:85-100 | Breadcrumb uses document navigation while My plan is unmigrated; router navigation with explicit heading-focus state once migrated | Vitest flag false/true (restored in finally), lazy destination and negative focus; parity keyboard legacy exit |

The resource-index composition uses the pinned kit Page, PageHeader, Toolbar, Table, Meter, Badge, Text, empty states, ErrorPanel and TableSkeleton. The template forces search and selection, PageToolbar always renders search, and DataTable has no row-header option. The kit primitives provide the specified count-only toolbar, semantic row headers and responsive table without sample-data defaults or new kit components. Every visible or accessible label is supplied from both catalogs; unused actions and data slots are explicitly empty.

Legacy changes since the blueprint are carried forward: session/http extraction uses packages/console-api; tenantless role semantics are unchanged. Newly added tenant history and lifecycle endpoints in planManagementApi.ts are outside this page's request closure and are not called. Legacy source and tests remain unchanged. There was no legacy Playwright journey in the approved entry; the companion mirrors the legacy Vitest fixtures and adds the blueprint's state fixtures using synthetic identities.

The synthetic storage dimension is labelled Synthetic Storage to distinguish API data from the English UI label Storage rejected by the Spanish locale check. Vitest and parity assert that every API dimension label renders unchanged in both locales; the shared locale and accessibility checks remain intact.

Browser parity, axe, CSP and viewport checks require PR CI because Chromium is unavailable in the maker sandbox. Visual screenshots require the independent checker's assessment and operator approval; CI screenshots alone do not approve baselines. No visual approval is claimed by the maker.

The browser-session registry adds only the manifest import and endpoint spread. The spread checks whether the import binding exists because the existing docs negative test strips all imports and evaluates the helper with the earlier dependency bindings. In that import-stripped case no allocation fixture is registered, preserving fail-closed handling; the ordinary imported helper always registers the allocation endpoint. No pre-existing test is changed.
