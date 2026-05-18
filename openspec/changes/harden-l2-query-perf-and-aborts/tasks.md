## 1. Failing tests

- [ ] 1.1 [test] Add `AuditEventFilters.test.tsx` cases: (a) unmount within
      300 ms of a keystroke does not invoke `onChange`, proving B12 from
      `:22-30`; (b) the ref initialiser compiles cleanly under React 19
      strict types, proving B13 from `:22`.
- [ ] 1.2 [test] Add `useAuditEvents.test.ts` cases: (a) the hook does not
      fetch on mount with empty filters, proving B18; (b) changing filters
      mid-flight aborts the previous `fetch`, asserted by inspecting the
      mock fetch's `signal.aborted`, proving B20.
- [ ] 1.3 [test] Add a case asserting `useInfiniteQuery` is configured with
      `staleTime >= 60_000` and `refetchOnWindowFocus === false`, proving
      B17 from `:15-23`.

## 2. Implementation

- [ ] 2.1 [impl] Add `apps/console/src/lib/useDebouncedValue.ts`
      encapsulating the debounce with a `useEffect` cleanup; ref is
      initialised as `useRef<NodeJS.Timeout | null>(null)`.
- [ ] 2.2 [fix] Replace the raw `setTimeout` in
      `AuditEventFilters.tsx:22-30` with `useDebouncedValue`; emit
      `onChange` only after the debounced value settles.
- [ ] 2.3 [fix] Configure `useInfiniteQuery` in
      `useAuditEvents.ts:15-23` with `staleTime: 60_000`,
      `refetchOnWindowFocus: false`, and `retry: 1`.
- [ ] 2.4 [fix] Default `enabled` in `useAuditEvents.ts` to
      `Boolean(filters.tenantId || filters.from || filters.to)` so the
      hook does not auto-fire with empty filters.
- [ ] 2.5 [fix] Thread the React Query `signal` into `fetchAuditEvents` in
      `lib/api/backup-audit.api.ts` and pass it as `fetch(..., { signal })`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/console test` and
      `openspec validate harden-l2-query-perf-and-aborts --strict`; both
      green.
