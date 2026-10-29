# Plan catalog migration evidence

- Page: `console-plan-catalog-page`, `/console/plans`, wave u2, issue #1276, risk R1.
- Assigned worktree branch: `agent/falcone/1276/4f1cb9c0-9630-59a2-bdb7-9cef42f43ce2`.
- Blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
- Approved canonical page entry SHA256: `a89c4890834a91b413a4c94e3176229d18690523a6fd11b4ceef129520b15ad0` (control-plane input).
- Offline Hermes kit snapshot SHA256: `43dc67996c70214e47d8a930ba1f351e2cf6d26ea6c5e92d3e8a0e12a9188063`. Installed UI, blocks and templates are pinned to `0.11.0`; package pins are unchanged.

## Request parity and legacy changes

`src/pages/consolePlanCatalog/api.ts` uses `requestConsoleSessionJson` from `@in-falcone/console-api/session`, matching the legacy client in `apps/web-console/src/services/planManagementApi.ts:290`. The only page request is GET `/v1/plans`, without a body. The query preserves the legacy parameter order: optional `status`, then `page`, then `pageSize`; `all` omits `status`. Defaults remain page 1 and pageSize 20. Both `items` and `plans` envelopes and metadata defaults are preserved.

The supplied legacy diff from `fecb3a03` to `2364ad09` moves the transport to the shared package, deletes its old HTTP implementation, and adds tenant history and lifecycle history service declarations. The shared transport change is carried over. Those new declarations are not called by the legacy catalog and remain outside this page's request list. No legacy catalog behavior, validation, state or copy changed in that diff. Legacy sources remain unchanged.

## Approved additions for flow C

The approved request explicitly adds server pagination (20, 50 or 100 rows), retry with the exact current query, localized timestamps, and the specified structured error states. These are accepted behavior changes from the legacy catalog rather than unintended parity drift. Select changes remain immediate and reset the page, with no submit button. Clearing also resets the page. Slug and Open links retain the plan ID path.

## Kit composition and localization

The resource-index pattern is composed from Page, PageHeader, PageToolbar, DataTable, empty-state blocks, TableSkeleton and ErrorPanel. All data and action slots are explicit. DataTable uses `paginated={false}`; the approved Pagination + SimpleSelect + Text fallback controls server paging with translated names and summaries. Status tones preserve the legacy neutral/success/warning/neutral mapping.

PageToolbar in the pinned kit has an unconditional search field. Page-local CSS hides its search wrapper and empty end slot, following the existing operations page pattern. It adds no colours or other visual tokens. The browser journey asserts that the search is absent from the accessible surface. Catalog strings, including ICU plurals, accessible names, request-ID controls and announcer messages, are in both locale catalogs.

## Tests and review boundaries

The unit test ports legacy rendering, semantic links, navigation and immediate filter regression coverage, and adds exact URL assertions, server paging, page-size reset, normalization, late-response suppression, loading, empty/error states, retry focus, refresh/redirect and permission denial. Harness negatives reject extra keys, missing required keys, wrong methods, wrong paths and unrelated queries.

The parity spec covers es/en at 375, 768 and 1280 pixels, including axe, focus, runtime health, locale checks, table scrolling, stacked empty actions, navigation and SHA256-labelled screenshot artifacts. CSP uses the 45-mixed synthetic fixture and retains strict query rejection for unrelated endpoints.

Chromium is unavailable in the maker sandbox; PR CI runs browser parity, axe, responsive and CSP checks. Screenshot artifacts still require the independent checker's assessment and operator approval. No visual approval is claimed here. The offline kit MCP server is unavailable, so validate_page is NOT_RUN; repository colour and i18n checks are used locally. Merge ordering still requires the plan detail migration and the listed blueprint prerequisites. This maker performs no merge or deployment.
