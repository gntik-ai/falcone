## Why

Multiple filter and API-client defects in `apps/console/` produce wrong
queries, wrong wire-format requests, and unusable UI affordances. From
`openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B2** (`apps/console/src/components/backup/AuditEventFilters.tsx:9-12`) —
  `EVENT_TYPES` declares 10 backup/restore types; the L1 backend emits 24 +
  4 (confirmation, simulation, collector). Users cannot filter on the missing
  14+ types.
- **B6** (`AuditEventFilters.tsx:78, :84`) — `datetime-local` values are
  parsed as local time but the backend filters by UTC. A user in UTC-8
  picking 09:00 sees the query become `from=17:00Z` with no visible
  affordance.
- **B10** (`apps/console/src/lib/api/backup-audit.api.ts:7`) — `BASE_URL`
  defaults to `''` (same-origin). In production the API lives at a different
  host than the console; the request 404s.
- **B11** (`AuditEventFilters.tsx:63-74` and `:50-62`) — `result` and
  `eventType` dropdowns overlap semantically. `eventType=backup.completed AND
  result=failed` is selectable and produces a contradictory query.
- **G7** (`AuditEventTable.tsx:54`) — `colSpan={role === 'admin' ? 7 : 5}` is
  a magic number tied to the thead column count; adding a column requires
  changes in two places.

## What Changes

- Derive `EVENT_TYPES` from a single source: import the canonical
  `AUDIT_EVENT_TYPE` union published by L1 (or generate it from the OpenAPI
  spec) so the filter list cannot drift.
- Render the `datetime-local` value with an explicit `(UTC)` label and
  display the converted UTC ISO string under the input so the user sees the
  shift.
- Require `VITE_API_BASE_URL` at build time; throw a clear startup error if
  the variable is unset rather than silently falling back to `''`.
- Disable the `result` dropdown options that conflict with the selected
  `eventType` suffix (e.g., choosing `backup.completed` greys out
  `result=failed`).
- Replace `colSpan={role === 'admin' ? 7 : 5}` with a constant derived from
  the table's column array length so adding a column updates one site.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: audit-filter event-type vocabulary, datetime-zone
  handling, API base URL contract, and dropdown coherence.

## Impact

- **Affected code**: `apps/console/src/components/backup/AuditEventFilters.tsx`,
  `apps/console/src/components/backup/AuditEventTable.tsx`,
  `apps/console/src/lib/api/backup-audit.api.ts`, new
  `apps/console/src/lib/constants/audit-event-types.ts`.
- **Migration required**: none.
- **Breaking changes**: deployments without `VITE_API_BASE_URL` will fail
  startup — this is the intended behaviour and prevents the silent
  same-origin 404.
- **Out of scope**: backend wire format for `event_type` (comma vs array) —
  flagged as `B21` in the audit and tracked under L1.
