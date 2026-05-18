## Why

The audit pages collapse every API failure into a blank table and trust the
`tenantId` prop unconditionally, hiding errors and risking cross-tenant
queries. From `openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B4** (`apps/console/src/lib/api/backup-audit.api.ts:32-34`) — every
  non-2xx response throws the same `Audit query failed: ${res.status}`. The
  UI cannot distinguish 401 (session expired), 403 (scope missing), 422 (bad
  cursor), or 500 (server error).
- **B5** (`apps/console/src/pages/admin/BackupAuditPage.tsx:28-42`,
  `pages/tenant/BackupAuditSummaryPage.tsx:29-43`) — only an
  `isLoading ? <p>Loading...</p> : <table>` branch is rendered. There is
  no `isError` branch and no empty-state branch; a 500 looks identical to
  "no events match".
- **B19** (`pages/tenant/BackupAuditSummaryPage.tsx:9, :13, :27`) — `tenantId`
  is a plain prop with no validation. Combined with B10 (host-fallback) and
  the L1 backend's open scope-check issues, an attacker who controls the
  parent component can query other tenants' audit logs.
- **G8** — `useInfiniteQuery` errors are surfaced as `error` on the query
  object but no page renders them.
- **G14** — no empty-state UI; an `events.length === 0` result renders an
  empty `<tbody>`.
- **G15** — `tenantId` is untrusted; no shape check, no claim-binding to the
  current session.

## What Changes

- Replace the generic error throw in `backup-audit.api.ts:32-34` with a
  typed `AuditApiError` carrying `status`, `code` (parsed from the response
  body's `error.code` when present), and `message`; map HTTP statuses to
  named codes (`UNAUTHENTICATED`, `FORBIDDEN`, `BAD_CURSOR`, `SERVER_ERROR`).
- Add `<ErrorBanner>` and `<EmptyState>` components to both pages; render
  them when `query.isError` or when `events.length === 0`.
- Validate the `tenantId` prop in `<BackupAuditSummaryPage>` against the
  JWT's `tenant_id` claim from the token context; throw if they differ.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: API error taxonomy, page error/empty rendering, and
  tenant-id prop trust boundary.

## Impact

- **Affected code**: `apps/console/src/lib/api/backup-audit.api.ts`,
  `apps/console/src/pages/admin/BackupAuditPage.tsx`,
  `apps/console/src/pages/tenant/BackupAuditSummaryPage.tsx`, new
  `apps/console/src/components/ErrorBanner.tsx`,
  `apps/console/src/components/EmptyState.tsx`,
  `apps/console/src/lib/api/audit-api-error.ts`.
- **Migration required**: none.
- **Breaking changes**: callers of `fetchAuditEvents` that catch the old
  `Error` MUST migrate to `AuditApiError`; only the two pages call this.
- **Out of scope**: implementing a session-refresh flow on `UNAUTHENTICATED`
  (deferred to a future auth-wiring change).
