## Why

The audit query hook leaks timers, fires unnecessary calls, and lets stale
responses overwrite fresh ones. From `openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B12** (`apps/console/src/components/backup/AuditEventFilters.tsx:22-30`)
  — `useRef` holds a `setTimeout` id; no `useEffect` cleanup. The debounce
  fires after the component unmounts and triggers state updates on a
  dead parent.
- **B13** (same file `:22`) — `useRef<ReturnType<typeof setTimeout>>()` is
  initialised with no argument; React 19 strict typings require an explicit
  `null`.
- **B17** (`apps/console/src/hooks/useAuditEvents.ts:15-23`) —
  `useInfiniteQuery` is created with React Query's defaults (`staleTime: 0`),
  refetching on window focus. Audit data is large; this is wasteful.
- **B18** (same hook) — `enabled: true` default means the query fires on
  mount with empty filters, pulling all events for the tenant with no
  `limit` defaulted.
- **B20** (same hook) — changing filters creates a new query key but does
  not abort the in-flight previous request; the stale response can land
  and update its cache entry.
- **G9/G10/G12/G13** — no `AbortController`, no retry config, no cache
  config, no signal threading from React Query into `fetch`.

## What Changes

- Replace the raw `setTimeout` debounce with a `useDebouncedValue` hook
  whose `useEffect` cleanup clears the timer on unmount. Initialise the
  ref with `null` to satisfy strict React 19 typings.
- Configure `useInfiniteQuery` with `staleTime: 60_000`,
  `refetchOnWindowFocus: false`, and `retry: 1`.
- Default `enabled` to `Boolean(filters.tenantId || filters.from ||
  filters.to)` so the hook does not auto-fire on mount with empty filters.
- Thread the React Query `signal` into `fetchAuditEvents` and pass it as
  `fetch(..., { signal })`; filter changes now abort the prior request.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: audit-query hook lifecycle, debounce safety, query
  caching, and abort propagation.

## Impact

- **Affected code**: `apps/console/src/hooks/useAuditEvents.ts`,
  `apps/console/src/components/backup/AuditEventFilters.tsx`,
  `apps/console/src/lib/api/backup-audit.api.ts`, new
  `apps/console/src/lib/useDebouncedValue.ts`.
- **Migration required**: none.
- **Breaking changes**: callers depending on the auto-fetch-on-mount
  behaviour MUST provide at least one filter or set `enabled: true`
  explicitly.
- **Out of scope**: replacing React Query with another data layer; URL
  persistence of filters (G-S3.4 in the audit, tracked separately).
