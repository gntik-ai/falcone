# Console quota/metric breach visibility (`/console/quotas`, `/console/observability`)

Issue #766: the Quotas (`apps/web-console/src/pages/ConsoleQuotasPage.tsx`) and Observability
(`apps/web-console/src/pages/ConsoleObservabilityPage.tsx`) pages rendered an over-limit
dimension in a way that was, in practice, indistinguishable from a healthy one. This page
documents the breach-visibility contract those two pages (and the shared `ConsumptionBar`
primitive) now follow, and the byte-humanization rule.

## The clamp bug

`lib/console-metrics.ts::normalizeMetricsOverview` and `lib/console-quotas.ts::normalizeQuotaPosture`
both compute `pctUsed` **un-clamped**:

```ts
const pctUsed = hardLimit && hardLimit > 0 ? Math.round((measuredValue / hardLimit) * 100) : null
```

So a dimension at `49/20` reports `pctUsed = 245`. `ConsoleMetricDimensionRow.tsx` used to feed
that straight into a native `<progress max={100} value={pctUsed ?? 0}>`. The HTML `<progress>`
element clamps its rendered fill to `max` whenever `value` exceeds it — so `value={245}` against
`max={100}` rendered an unremarkable, fully-filled bar, identical to a healthy `value={100}`.
`ConsoleQuotasPage.tsx`'s own `QuotaTable` had a milder version of the same problem: an
over-limit row was tinted red, but only via a faint background color and red text — a
color-only cue (WCAG 1.4.1 requires a non-color one too).

## The severity taxonomy (shared, not re-derived per surface)

Both `console-quotas.ts` and `console-metrics.ts` derive the same two booleans from `pctUsed`:

- `isWarning = pctUsed >= 80 && pctUsed < 100`
- `isExceeded = pctUsed >= 100`

A dimension **exactly at** its limit is already `isExceeded` — not a distinct "at capacity but
still healthy" state. `ConsoleMetricDimensionView` (`lib/console-metrics.ts`) previously lacked
these two fields (only `ConsoleQuotaDimensionView` had them); it now carries them too, computed
identically, so the Observability metric rows and the Quotas table apply the exact same
thresholds.

## The fix: `ConsumptionBar`'s over-limit treatment, reused everywhere

`ConsumptionBar.tsx` (`apps/web-console/src/components/console/ConsumptionBar.tsx`) already
existed as an emerald→amber→red bar, but was only wired into `QuotaConsumptionTable.tsx` (the
Plan/Workspace pages) — never the Quotas or Observability pages, and its own fill-width clamp
(`Math.min((current / limit) * 100, 100)`) had the same "clamp hides breach" property as the
native `<progress>` it was meant to replace.

`ConsumptionBar` now adds, when `limit > 0 && current >= limit`:

- A diagonal hazard-stripe `backgroundImage` overlay on the fill (an inline style, not a Tailwind
  arbitrary class, so it never depends on the PostCSS/Tailwind build pipeline resolving an
  arbitrary gradient value) — visually distinct from a flat color fill.
- A `data-testid="consumption-bar-breach-marker"` badge below the bar, with an `AlertTriangle`
  icon and the text "Por encima del límite" — a second, independent, non-color cue.

The fill's **width** is still capped at 100% (letting it overflow the track would break every
table/card layout the primitive is embedded in) — but the clamp is deliberately never the *only*
signal anymore.

`ConsumptionBar` also gained an optional `formatValue` prop (default: `String`) so callers can
render humanized units (see below) without duplicating the bar's internal markup. Its existing
test contract is unchanged: `data-testid="consumption-bar-fill"`, `role="progressbar"`, and its
`aria-valuetext` (which already said "por encima del límite" for an over-limit value).

`ConsoleMetricDimensionRow.tsx` drops the native `<progress>` entirely and renders
`ConsumptionBar` instead, plus a destructive `Badge` + `AlertTriangle` icon on the `% usado`
value itself when `isExceeded`. `ConsoleQuotasPage.tsx`'s `QuotaTable` adds the same destructive
`Badge` to its `% uso` cell, strengthens the exceeded row's background tint, and adds a left
accent border on the leading cell (`border-l-4`, reusing the `border-l-*`/`border-l-transparent`
idiom already established in `ConsoleTenantsPage.tsx`) — the warning tier (`isWarning`, 80-99%)
is unchanged.

## Byte-unit humanization (`lib/format.ts`)

`formatBytes` existed twice, near-identically, in `ConsoleStoragePage.tsx` and
`ConsoleMongoPage.tsx`. It is now a single implementation in
`apps/web-console/src/lib/format.ts`, and both pages import it instead of shipping their own
copy (verified byte-identical against both pages' existing tests: `2.0 KB`, `4.0 KB`, `8.0 KB /
16 KB`).

Whether a dimension's value should be humanized as bytes is decided by
`isByteUnitDimension(unit, dimensionId)`:

1. If the wire's `unit` field (`'count' | 'bytes'` — see
   `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql`'s
   `quota_dimension_catalog.unit CHECK (unit IN ('count', 'bytes'))`, and the
   `QuotaDimensionPosture`/usage-view OpenAPI schemas) is present, it is authoritative.
2. If `unit` is absent (some deploy runtimes' handlers do not populate it on every response),
   fall back to the `dimensionId` naming convention observed in the same catalog
   (`max_storage_bytes`, `storage_volume_bytes`, ...): a `_bytes`/`.bytes` suffix.
3. Otherwise, the dimension is treated as a plain count and is **never** run through
   `formatBytes` — a count dimension (API keys, requests, workspaces, ...) must never be
   GiB-ified.

`ConsoleQuotaDimensionView` and `ConsoleMetricDimensionView` both gained an optional `unit`
field to carry this through from the wire; `formatDimensionValue(value, unit, dimensionId)` is
the single entry point both the Quotas table and the metric rows call for a dimension's
limit/measured value.

## Wayfinding cross-links

`ConsoleQuotaPostureBadge.tsx` gained an opt-in `linkTo` prop: when provided, the badge is
wrapped in a `react-router-dom` `Link` to that path; when omitted (the default), the component
renders exactly as before (no `Router` context required — every pre-existing render of this
component is unaffected). Both the Quotas and Observability page headers now pass
`linkTo="/console/quotas"`. An exceeded `ConsoleMetricDimensionRow` also renders a "Ver cuotas de
la organización" link to `/console/quotas`.

## Audit triage depth

The audit tab's event-id cell (`ConsoleObservabilityPage.tsx`) is now a real `Button
variant="link"` with `font-mono` styling and `aria-expanded`/`aria-controls` disclosure
semantics (previously a bare `<button className="font-medium underline">` with no ARIA state).
A result-count line is shown above the table; because `useConsoleAuditRecords` hard-codes
`page[size]=50` and returns no cursor/`hasMore`, there is nothing to paginate against, so the
count line honestly notes the 50-item cap instead of the page inventing pagination the backend
does not support. The already-modeled `ConsoleAuditFilter.from`/`.to` date-range fields
(previously wired into the fetch via `appendDateFilters` but never exposed in the UI) now have
`<input type="date">` controls.

## Contract note

This is a frontend-only, read-only change over existing endpoints — no `*.openapi.json`,
generated client/SDK, `internal-contracts`, or `public-route-catalog.json` entry changed.
`npm run generate:public-api` produces no diff.
