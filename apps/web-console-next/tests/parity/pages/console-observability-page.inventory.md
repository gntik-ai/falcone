# Observability migration evidence

Page: `console-observability-page`, blueprint SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Approved entry SHA256: `ea38e3cc639380ab454ab25cc689a4951e4db2d7221f7b6dfbe5ce51310abcaa`.
Delivery base: `ca0b50f4588fdf891c58f1cc4bba3366ca0ce692`.
Kit: the supplied Hermes snapshot `666ceb36c23b1c885d5c2af202ff74235ada3b0c7104c1b7309969d6a0a50de3`, packages pinned to 0.11.0 (tokens 0.3.0). No MCP server is configured, so validate_page cannot run.

## Requests

The page-local module `src/pages/consoleObservability/api.ts` sends the nine listed endpoints through `requestConsoleSessionJson`, field for field as `apps/web-console/src/lib/console-metrics.ts:252-366`: overview and usage with no query, the workspace series with `metricKey=api_requests&window=<w>`, audit records with `page[size]=50&sort=-eventTimestamp` plus the legacy `filter[...]` parameters, and the audit export with `{ filters }`. `GET tenants/{}/series` is never sent and never registered. Every fixture of the spec asserts the allowlist at teardown.

## Legacy delta since the blueprint

Inspected from `fecb3a03` to the delivery base. `22072f17` adds the `not_enforced` policy mode, which the new page renders as the `Cuota no aplicada` badge (vitest: workspace scope load). `0b685425` moves the session, permissions and context types to `@in-falcone/console-api`; the new page already uses them. No legacy source or test is edited.

## Differences

| Id | Difference | Legacy reference | Asserted by |
| --- | --- | --- | --- |
| D1 | `Cargar mas` with a loaded count replaces the 50-record cap note; cursor `page[after]` with the same filters | `ConsoleObservabilityPage.tsx:337-344` | vitest "Cargar mas sends the cursor..."; spec `action`, `error-empty` |
| D2 | A failed export shows an error-panel with status code, request id and `Reintentar`, which re-posts the identical body | `ConsoleObservabilityPage.tsx:317-328` | vitest "a failed export..."; spec `action`, `error-empty` |
| D3 | The event detail opens in a drawer with a description list and a JSON viewer, and focus returns to the event id | `ConsoleObservabilityPage.tsx:358-387`, `ConsoleAuditRecordDetail.tsx:3-14` | vitest "an event id opens the detail drawer..."; spec `data`, `accessibility` |
| D4 | The `api_requests` series renders in a chart-card with its range toggle hidden and a text summary | `console-metrics.ts:190-201` (the legacy page never drew it) | vitest "renders the series chart card...", "usage points fill an empty series"; spec `data` |
| D5 | Timestamps are locale formatted | `ConsoleObservabilityPage.tsx:188`, `:381` | spec `data` (last-updated `time` text) |
| D6 | Kit tones (meter levels, status-tag, badge, inline-callout, error-panel) replace the emerald, amber and red classes | `ConsoleMetricDimensionRow.tsx:28-31`, `ConsoleQuotaPostureBadge.tsx:27-33`, `ConsoleAuditResultBadge.tsx:13-15` | spec `kit-conformance`; `pnpm lint:colours` |
| D7 | 403 and 404 render in-page states instead of the raw error text; no backend text is shown | `ConsoleObservabilityPage.tsx:182`, `:333`, `console-metrics.ts:123-134` | vitest "metrics 403/404 ..."; spec `error-empty` |
| D8 | The disabled window reason sits in a tooltip linked by `aria-describedby` | `ConsoleTimeRangeSelector.tsx:47-51` | vitest "tenant scope sends no series..."; spec `error-empty` |
| D9 | Kit tabs replace the two outline buttons | `ConsoleObservabilityPage.tsx:165-170` | spec `data`, `accessibility` |
| D10 | Two kit `DatePicker` fields with catalog labels replace the two native date inputs; Desde and Hasta stay independent and keep the `YYYY-MM-DD` form | `ConsoleObservabilityPage.tsx:220-227` | vitest "the audit dates are independent..."; spec `locale` |
| D11 | The empty audit state offers `Limpiar filtros` | `ConsoleObservabilityPage.tsx:334` | vitest "the empty audit state offers Limpiar filtros..." |
| D12 | `Exportar auditoria` is the primary button | `ConsoleObservabilityPage.tsx:232-241` | spec `responsive` (full width at 375) |
| D13 | A client-side dimension search sits in the metrics toolbar and sends no request | none | vitest "the dimension search is local..." |

### D10 choice

`DateRangeFilter` (blocks 0.11.0) only commits complete ranges, so a from-only or to-only query, which the legacy page allowed, could not be issued. The two date-picker fallback is used instead: each `DatePicker` has its own catalog label, placeholder and clear label, and the calendar chrome comes from the kit's `I18nProvider` locale. The spec locale assertion runs on the audit surface in es; any English chrome there is a defect.

## Checks

Unit and routing coverage run in vitest: `tests/consoleObservability.test.tsx` and `tests/consoleObservability-routing.test.tsx`, which also hold the rollback and 401 cases. The browser journey `console-observability-page.spec.mjs` runs both harness roles in es and en at 375, 768 and 1280 px. The restricted role (`tenant_developer`) is asserted in vitest and, through the entry-chunk role seed used by the quotas journey, in the spec, because the parity `Role` type does not list it.

Seeded mutations, run locally and not committed, each fail a vitest test: a `window` parameter on overview, a dropped `page[size]=50`, an audit GET for `tenant_developer`, and an appended audit page applied after a workspace switch.

Browser execution (parity, axe, viewport, CSP) and visual baseline approval run in PR CI, because Chromium is unavailable in the maker sandbox. Screenshots are attached with SHA256 names by the spec for the checker and the operator.

The spec runs the shared locale check through a local wrapper that hides the shell workspace switcher's trigger while it reads "Select workspace". With no active workspace, the u0-owned shell renders that built-in English kit text (gap-kit-builtin-copy-english). It is not this page's copy, and the page's own copy stays under the shared check.
