# Capability L2 — Backup Audit Reporting UI

**Source locus:** `apps/console/` — **385 LOC across 8 TS/TSX files**. Tree (verified by `find`):
```
apps/console/
└── src/
    ├── components/backup/{AuditEventTable,AuditEventDetail,AuditEventFilters,AuditEventTypeBadge}.tsx
    ├── hooks/useAuditEvents.ts
    ├── lib/api/backup-audit.api.ts
    └── pages/{admin/BackupAuditPage,tenant/BackupAuditSummaryPage}.tsx
```

**Headline finding up front:** `apps/console/` is **not a deployable application**. It has:
- **No `package.json`** — `ls -la apps/console/` shows only the `src/` directory.
- **No `tsconfig.json`, `vite.config.ts`, `index.html`, or any build config**.
- **No router** (`react-router` integration is not present in source).
- **No tests** (no `*.test.*` file in the tree).
- **No README** or any other top-level file.

The capability is a set of loose React component files referenced by the capability map as `/backup-audit` and `/backup-audit-summary` UI screens, but no router maps those paths, no build pipeline can compile the imports (which depend on `@tanstack/react-query` not declared anywhere in the directory), and no entry point exists. **The UI cannot run as-is.** Either the components are intended to be ported into `apps/web-console/` (which has 65+ pages and full build config), or this is dead code.

**Method.** Read all 8 files end-to-end. Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

Other immediate observations:
- Components import types from `../../../../services/backup-status/src/audit/audit-trail.types.js` — **cross-service relative import** with the `.js` extension on a `.ts` source. Same layering anti-pattern flagged in C2/D2/E2.
- `EVENT_TYPES` in `AuditEventFilters.tsx:9-12` declares only 10 event types but the audit-trail backend (per L1 audit) emits 24 + 4 from migration 004. The UI can't filter on collector or simulation events.

---

## SPEC (what exists)

### S1. API client

- **WHEN** `fetchAuditEvents(filters, token)` is invoked, **THE SYSTEM SHALL** construct a `URLSearchParams` from the filters (`tenant_id`, `event_type`, `actor_id`, `operation_id`, `result`, `from` (ISO), `to` (ISO), `limit`, `cursor`), then `fetch(\`${BASE_URL}/v1/backup/audit?${params}\`, { headers: { Authorization: \`Bearer ${token}\` } })` (`lib/api/backup-audit.api.ts:9-30`).
- **WHEN** `filters.eventType` is an array, **THE SYSTEM SHALL** join with commas (`:16-19`).
- **WHEN** the response is not `ok`, **THE SYSTEM SHALL** throw `new Error(\`Audit query failed: ${res.status}\`)` (`:32-34`).
- **WHEN** `VITE_API_BASE_URL` is unset, **THE SYSTEM SHALL** default `BASE_URL` to empty string (`:7`).

### S2. React Query hook

- **WHEN** `useAuditEvents({filters, token, enabled = true})` is invoked, **THE SYSTEM SHALL** return a `useInfiniteQuery` with `queryKey: ['audit-events', filters]`, calling `fetchAuditEvents` per page, deriving `nextCursor` from `lastPage.pagination.nextCursor` (`hooks/useAuditEvents.ts:15-23`).
- **WHEN** `enabled === false`, **THE SYSTEM SHALL** suspend the query.

### S3. Admin page

- **WHEN** `<BackupAuditPage token={...} />` renders, **THE SYSTEM SHALL** show `<h1>Backup Audit Trail</h1>`, render `<AuditEventFilters role="admin" />`, and on data arrival render `<AuditEventTable role="admin" />` plus a "Load more" button if `hasNextPage` (`pages/admin/BackupAuditPage.tsx:11-45`).
- **WHEN** the user clicks "Load more", **THE SYSTEM SHALL** call `fetchNextPage()` (`:35`).

### S4. Tenant page

- **WHEN** `<BackupAuditSummaryPage token={...} tenantId={...} />` renders, **THE SYSTEM SHALL** initialise filters with the supplied `tenantId`, render `<h1>Backup Activity History</h1>` and use `role="tenant_owner"` for filters and table (`pages/tenant/BackupAuditSummaryPage.tsx:12-46`).
- **WHEN** filter changes propagate, **THE SYSTEM SHALL** always re-merge `tenantId` into the next filters (`:27`).

### S5. Filters component

- **WHEN** the filters mount, **THE SYSTEM SHALL** render local state for `tenantId, actorId, eventType, result, from, to` (`AuditEventFilters.tsx:15-20`).
- **WHEN** any input changes, **THE SYSTEM SHALL** debounce 300 ms before invoking `onChange(patch)` (`:24-30`).
- **WHEN** `role === 'admin'`, **THE SYSTEM SHALL** render `tenantId` and `actorId` text inputs; tenant role hides both (`:34-49`).
- **WHEN** `eventType` is selected, **THE SYSTEM SHALL** restrict options to a hard-coded list of 10 event types (`'backup.{requested,started,completed,failed,rejected}'`, `'restore.{requested,started,completed,failed,rejected}'`) (`:9-12, :50-62`).
- **WHEN** `result` is selected, **THE SYSTEM SHALL** offer `{accepted, rejected, started, completed, failed}` (`:63-74`).
- **WHEN** `from`/`to` are picked, **THE SYSTEM SHALL** convert each `datetime-local` value via `new Date(e.target.value)` and pass as Date object (`:75-86`).

### S6. Table

- **WHEN** events are rendered, **THE SYSTEM SHALL** display columns `Timestamp, Event Type, Actor, Tenant, Result` plus admin-only `Source IP` and `Component` (`AuditEventTable.tsx:14-26`).
- **WHEN** `role === 'admin'`, **THE SYSTEM SHALL** show `event.actor_id` in the Actor column; tenant role shows `'—'` (`:38-40`).
- **WHEN** `role === 'admin'`, **THE SYSTEM SHALL** show `event.source_ip ?? '—'` and `\`${component_type}/${instance_id}\`` (`:44-49`).
- **WHEN** a row is clicked, **THE SYSTEM SHALL** toggle `expandedId` to render an `<AuditEventDetail>` row beneath (`:30-33, :52-58`).
- **WHEN** the expanded detail spans the table, **THE SYSTEM SHALL** use `colSpan={role === 'admin' ? 7 : 5}` (`:54`).

### S7. Detail view

- **WHEN** `role === 'admin'`, **THE SYSTEM SHALL** display `ID`, `Correlation ID`, optional `Operation` (as link to `/admin/backup/operations/${id}`), `Component`, optional `Snapshot`, `Actor` with `actor_role`, optional `Session ID`, `Source IP`, `User Agent`, `Rejection Reason`, and `Detail` (with truncation marker if `detail_truncated`) (`AuditEventDetail.tsx:9-38`).
- **WHEN** `role === 'tenant_owner'`, **THE SYSTEM SHALL** display only `ID`, optional `Operation ID`, optional public rejection (labelled `'Motivo:'` — Spanish) (`:41-50`).

### S8. Event-type badge

- **WHEN** `<AuditEventTypeBadge eventType={...} />` renders, **THE SYSTEM SHALL** extract the suffix after `.` and pick a colour from `{requested→blue, started→blue, completed→green, failed→red, rejected→orange}`, defaulting to gray (`AuditEventTypeBadge.tsx:8-22`).

---

## GAPS

### G-cross. Cross-cutting

1. **`apps/console/` is unbuildable.** No `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, router, or tests. The capability cannot run as-is. See B1.
2. **`@tanstack/react-query` is not declared.** `useAuditEvents.ts:5` imports it; with no `package.json` in this directory, there's nowhere to declare the dep. Whoever builds this code must reach into a sibling app's dependency tree.
3. **Cross-service relative imports** for types: `../../../../services/backup-status/src/audit/audit-trail.types.js` (used in 4 of 8 files). Same layering anti-pattern as in C2/D2/E2.
4. **Hard-coded admin link `/admin/backup/operations/${id}`** in `AuditEventDetail.tsx:19` — no admin operations page exists in this app or in `apps/web-console/`. Click → broken link.
5. **Spanish label `'Motivo:'`** at `AuditEventDetail.tsx:47` while every other label is English. Same i18n inconsistency family as C2 (B15), G1 (B15), K1.
6. **No tests.** Empty test surface — no contract test asserts wire-format compatibility with the L1 backend's `/v1/backup/audit` route.

### G-S1. API client

- **G-S1.1** `eventType` array is joined with commas (`:18`). The L1 backend (`query-audit.action.ts:95-105` per L1 audit) accepts `event_type` as single or array — verify whether comma-separated string is a supported wire format.
- **G-S1.2** All non-2xx responses produce the same `new Error(\`Audit query failed: ${res.status}\`)`. UI cannot distinguish 401 (session expired), 403 (scope missing), 422 (bad cursor), 500 (server error). User sees one opaque message.
- **G-S1.3** `fetch` has no `signal` for abort. Filter changes mid-flight don't cancel the previous request.
- **G-S1.4** No retry / no exponential backoff for transient failures. `useInfiniteQuery` has built-in retry but the hook doesn't configure it.
- **G-S1.5** `BASE_URL` defaults to `''` (`:7`) — same-origin fetch. Works in dev with a proxy; in production, the API likely lives at a different host (per the capability map, `api.dev.in-falcone.example.com` per umbrella chart). No CORS handling.

### G-S2. Hook

- **G-S2.1** `useInfiniteQuery` defaults are used. No `staleTime`, no `cacheTime`, no retry config. With React Query's defaults, the query refetches on window focus — heavy for audit data.
- **G-S2.2** `enabled = true` default means the query fires on mount with empty filters. The first call retrieves all events for the tenant — a potentially large set with no `limit` defaulted.

### G-S3 / G-S4. Pages

- **G-S3.1** No empty-state UI — `events.length === 0` renders an empty table with only headers.
- **G-S3.2** No error-state UI — if the hook errors, `data` is undefined, the table renders empty. User cannot tell loading-finished-empty from error.
- **G-S3.3** `token` is a plain string prop. No refresh-on-401, no logout-on-403, no token-expiry handling.
- **G-S3.4** No URL persistence — filters are component-local state. Reloading the page resets all filters.
- **G-S3.5** No deep-linking to a specific event id. Once expanded, the event id is in component state only.
- **G-S4.1** `BackupAuditSummaryPage` accepts `tenantId` as a prop but does not validate it. A caller can pass any string.

### G-S5. Filters

- **G-S5.1** `EVENT_TYPES` declares 10 event types (5 backup + 5 restore). The L1 audit catalogued **24** event types in `audit-trail.types.ts` plus 4 added by migration 004. Missing: `backup.{ready,acked,…}`, all `restore.confirmation_*` events, all `restore.simulation.*` events. Users cannot filter on these.
- **G-S5.2** Multi-select for `eventType` not implemented — the select supports a single value, even though the API client accepts an array.
- **G-S5.3** `result` filter overlaps semantically with `event_type` suffix. `eventType: 'backup.completed' AND result: 'failed'` produces a contradictory query that the UI cannot prevent.
- **G-S5.4** `datetime-local` inputs interpret the value in the browser's local timezone. `new Date(value)` converts to a Date with UTC offset. Users in non-UTC regions see "from" and "to" shifted from their intent when the backend filters by UTC.
- **G-S5.5** Debounce uses `React.useRef<ReturnType<typeof setTimeout>>()` initialized with no argument (`:22`). Newer React 19+ types require an explicit initial value. Type-checking warning.
- **G-S5.6** No cleanup on unmount: the debounce timeout still fires after the component unmounts. React warning on state update of unmounted parent.
- **G-S5.7** Tenant-role filters expose `from/to/eventType/result` but not `actorId/tenantId` — by design, but the form layout doesn't visually communicate "you can't see other tenants".

### G-S6 / G-S7. Table & detail

- **G-S6.1** Clickable `<tr>` (`AuditEventTable.tsx:30-33`) lacks `role="button"`, `tabIndex={0}`, or `onKeyDown`. Keyboard users can't expand rows.
- **G-S6.2** `colSpan={role === 'admin' ? 7 : 5}` is a magic number tied to the thead column count. Adding a column requires updating both places.
- **G-S6.3** `new Date(event.occurred_at).toLocaleString()` (`:34`) uses browser locale. Operators in different regions see different date formats.
- **G-S6.4** `(event as AuditEventAdmin)` casts (lines 39, 44, 48) bypass type safety. If the wire data is `AuditEventPublic` despite `role === 'admin'`, the access yields `undefined` which renders as `'—'` or empty. The cast assumes server enforces the redaction model — which per L1 audit's open issues is partially broken.
- **G-S7.1** `Operation` link target `/admin/backup/operations/${id}` is dead (no such route in this app). 404 on click.
- **G-S7.2** `e.detail` rendered as a single string. If `detail` is JSON (which the backend stores as JSONB per `003_backup_audit_events.sql`), the user sees `"[object Object]"` or stringified blob with no formatting.
- **G-S7.3** No "Copy correlation ID" button. Operators triaging incidents must select+copy by hand.

### G-S8. Badge

- **G-S8.1** Colour map (`AuditEventTypeBadge.tsx:8-14`) covers only 5 suffixes. New audit event types (confirmation, simulation, missed, etc.) all render as gray.

---

## BUGS

### Confirmed (verified-by-author)

- **B1. `apps/console/` is not a buildable app.**
  Verified by `ls -la apps/console/` (only `src/` exists). No `package.json`, no `tsconfig.json`, no build config, no router, no entry point. The L2 capability cannot run — even setting aside cross-service imports, there's no `npm install` target, no `vite build`, no `index.html`. Best case it's intended to be inlined into `apps/web-console/`; worst case it's dead code.

- **B2. `EVENT_TYPES` filter list misses 14+ event types declared by the backend.**
  `AuditEventFilters.tsx:9-12` (verified-by-author) declares 10 types. Per the L1 audit, `audit-trail.types.ts` declares 24 event types plus 4 added by migration 004 (`restore.confirmation_pending`, `restore.confirmed`, `restore.aborted`, `restore.confirmation_expired`, `restore.simulation.*`). The UI cannot filter on confirmation, simulation, or collector cycle events at all.

- **B3. Admin "Operation" link is dead.**
  `AuditEventDetail.tsx:19` (verified-by-author): `<a href={\`/admin/backup/operations/${e.operation_id}\`} className="text-blue-600 underline">`. No route in this app maps `/admin/backup/operations/*`. `apps/web-console/` (the sibling app) also has no such route in any file I've audited. Click → 404.

- **B4. All API errors collapsed to a single generic message.**
  `lib/api/backup-audit.api.ts:32-34` (verified-by-author): `throw new Error(\`Audit query failed: ${res.status}\`)`. 401/403/422/500/503 all produce the same error path. The hook surfaces this as the query's `error`, but the pages don't render it — `data?.pages.flatMap(...)` falls back to `[]` and the table renders empty.

- **B5. No error or empty state in the pages.**
  `BackupAuditPage.tsx:28-42` and `BackupAuditSummaryPage.tsx:29-43` (verified-by-author). `isLoading ? <p>Loading...</p> : <AuditEventTable .../>`. There's no branch for `isError` or for empty `events`. A 500 from the backend looks identical to "no events match the filter".

- **B6. `datetime-local` filter values shift on timezone normalization.**
  `AuditEventFilters.tsx:78, :84`. The input value is parsed as local time by `new Date(value)`, then `toISOString()` is called by the API client (`backup-audit.api.ts:23-24`). A user in UTC-8 picking 09:00 sees the query become `from=17:00Z`. The label "From" implies local time but the wire is UTC. No visible affordance.

- **B7. Cross-service relative imports.**
  Four files import `../../../../services/backup-status/src/audit/audit-trail.types.js`. With no `tsconfig.json` path mapping, the resolver depends on whatever consumes these files. Renaming or moving `audit-trail.types.ts` silently breaks the UI.

- **B8. Spanish-only label `Motivo:` in tenant detail view.**
  `AuditEventDetail.tsx:47` (verified-by-author). Every other label in the file is English (`ID`, `Operation ID`, `Component`, `Snapshot`, `Actor`, `Session ID`, etc.). Inconsistent i18n; no locale switching framework.

- **B9. Keyboard accessibility absent on row expand.**
  `AuditEventTable.tsx:30-33` (verified-by-author). `<tr className="cursor-pointer" onClick={...}>`. No `role`, no `tabIndex`, no `onKeyDown`. Keyboard-only users can't expand events. WCAG 2.1 violation.

- **B10. `BASE_URL` default of `''` works only same-origin.**
  `backup-audit.api.ts:7` (verified-by-author): `import.meta.env.VITE_API_BASE_URL ?? ''`. The umbrella chart serves the API at `api.dev.in-falcone.example.com` while consoles live at `console.dev.in-falcone.example.com`. Without `VITE_API_BASE_URL` set at build time, fetch hits `console.dev.in-falcone.example.com/v1/backup/audit` (different host) — 404.

- **B11. `result` filter dropdown overlaps `event_type` suffix.**
  `AuditEventFilters.tsx:63-74` and `:50-62` (verified-by-author). Selecting `eventType='backup.completed' AND result='failed'` produces a query with no rows. The UI cannot prevent the contradiction.

### Likely (smells, defensive gaps)

- **B12. Debounce timeout fires after unmount.**
  `AuditEventFilters.tsx:22-30` (verified-by-author). The `useRef` holds a setTimeout id; no `useEffect` cleanup on unmount. React warning + setState on unmounted parent if user navigates away within 300ms of typing.

- **B13. `useRef<ReturnType<typeof setTimeout>>()` initialised with no argument.**
  `AuditEventFilters.tsx:22` (verified-by-author). Strict React 19 types may require an explicit initial value (`useRef<T | null>(null)`). Type-check failure once the consumer upgrades React typings.

- **B14. `colSpan={role === 'admin' ? 7 : 5}` is fragile.**
  `AuditEventTable.tsx:54` (verified-by-author). Magic numbers tied to thead column count. Adding a column requires changes in two places.

- **B15. `(event as AuditEventAdmin)` cast may yield `undefined` access.**
  `AuditEventTable.tsx:39, :44, :48` (verified-by-author). The cast assumes server enforces the redaction (returning admin shape for admin role). If the server misclassifies, the cast access becomes `undefined` and renders as `'—'` or `'undefined/undefined'` (for the component/instance pair).

- **B16. `e.detail` (JSONB on the backend) rendered as a single string.**
  `AuditEventDetail.tsx:33` (verified-by-author). The backend's `003_backup_audit_events.sql` stores `detail` as JSONB. React renders it via interpolation, which yields `[object Object]` for object detail. Operators get no structured view.

- **B17. `useInfiniteQuery` has no `staleTime` config.**
  `useAuditEvents.ts:15-23` (verified-by-author). React Query's default `staleTime: 0` means every window refocus triggers a refetch. Audit data is large; this is wasteful.

- **B18. Initial query fires on mount with empty filters.**
  Pages mount and immediately call the hook. The hook is `enabled: true` by default. First request goes out with no filter constraints — large pull.

- **B19. `tenantId` prop in `BackupAuditSummaryPage` is untrusted.**
  `BackupAuditSummaryPage.tsx:9, :13, :27` (verified-by-author). The component trusts whatever the parent passes. Combined with B10 (no CORS / wrong host fallback), an attacker who controls the parent app's props can query other tenants' audit logs (assuming the backend's scope check fails — see L1 audit B2).

- **B20. Filter changes don't abort in-flight requests.**
  `useAuditEvents.ts` (verified-by-author). React Query uses `queryKey: ['audit-events', filters]` — changing filters creates a new key but does not abort the old request, which lands and updates its (now-stale) cache entry.

### Needs verification

- **B21. Whether the L1 backend accepts comma-separated `event_type` strings.**
  `backup-audit.api.ts:18` sends `event_type=a,b,c`. The L1 audit's `query-audit.action.ts:95-105` was not deep-read; verify whether it expects `event_type=a&event_type=b` (URLSearchParams array form) or comma-separated.
- **B22. Whether the L1 backend's redaction matches the UI's assumption.**
  `AuditEventTable.tsx:38-49` assumes that for `role === 'admin'` requests, server returns `AuditEventAdmin`; for tenant_owner, `AuditEventPublic`. Whether the backend actually enforces this redaction per scope (per L1 audit B1's open issues around scope vs role) needs verification.
- **B23. Whether any operator-facing browser/locale standard governs the date display.**
  `AuditEventTable.tsx:34` uses `toLocaleString()`. Internal tooling typically standardises on ISO; verify against ops conventions.
- **B24. Whether the `apps/web-console/` app embeds or replaces these components.**
  `apps/web-console/src/lib/api/backup-audit.api.ts` — flagged by the L1 audit as the "specialized React app for backup/restore audit inspection". If `web-console` has its own variant, `apps/console/` is duplicate scaffolding.

---

## Scope note for downstream spec authoring

L2 cannot be specified as a working capability — there is no buildable application here. Before any OpenSpec proposal:

1. **Decide whether L2 is dead code.** If yes, delete `apps/console/`. If no, port the 8 components into `apps/web-console/src/pages/` (which has the build pipeline, router, and dependency tree) and remove the standalone `apps/console/` directory.
2. **Once a home is chosen**, the structural bugs (B1–B11) are not all blocking, but five are: B2 (filter event-type set incomplete), B3 (dead admin operation link), B5 (no error/empty state), B10 (CORS / hostname assumption), B11 (overlap of result vs event_type).
3. **Wire to a real backend contract.** B21 (comma vs array `event_type` wire format) needs alignment with the L1 backend. The L1 audit found that `apps/console/src/lib/api/backup-audit.api.ts` already exists — confirm whether this is the same file or a divergent fork.
4. **Replace cross-service relative imports.** The 4 files importing from `services/backup-status/src/audit/audit-trail.types.js` should depend on a published `@in-falcone/audit-types` package or generated types from the OpenAPI spec.
5. **Add tests.** No contract test covers the API client, no integration test exercises the pages. Empty test surface.

Until those decisions are made, the L2 spec is purely aspirational; no FRs are testable.
