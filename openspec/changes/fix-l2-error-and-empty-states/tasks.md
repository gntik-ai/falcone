## 1. Failing tests

- [ ] 1.1 [test] Add `apps/console/src/lib/api/backup-audit.api.test.ts`
      asserting `fetchAuditEvents` throws `AuditApiError` with `code` ∈
      {`UNAUTHENTICATED`, `FORBIDDEN`, `BAD_CURSOR`, `SERVER_ERROR`}
      depending on HTTP status, proving B4 from `:32-34`.
- [ ] 1.2 [test] Add `apps/console/src/pages/admin/BackupAuditPage.test.tsx`
      cases: (a) when query errors, an `<ErrorBanner>` renders; (b) when
      `events.length === 0`, an `<EmptyState>` renders, proving B5 and
      G8/G14 from `:28-42`.
- [ ] 1.3 [test] Add a case mounting `<BackupAuditSummaryPage tenantId="other"
      token={tokenWithTenantA}>` and asserting it throws or renders an
      error banner, proving B19 from `BackupAuditSummaryPage.tsx:9, :13, :27`.

## 2. Implementation

- [ ] 2.1 [impl] Add `apps/console/src/lib/api/audit-api-error.ts` defining
      `AuditApiError extends Error` with `status`, `code`, and `message`.
- [ ] 2.2 [fix] Replace the throw in `backup-audit.api.ts:32-34` with a
      response-body parse that maps status → `AuditApiError` code; preserve
      `cause` for diagnostics.
- [ ] 2.3 [impl] Add `<ErrorBanner>` and `<EmptyState>` components and
      render them in `BackupAuditPage.tsx:28-42` and
      `BackupAuditSummaryPage.tsx:29-43` based on `query.isError` and
      `events.length === 0`.
- [ ] 2.4 [fix] In `BackupAuditSummaryPage.tsx:9, :13, :27`, decode the JWT
      from the `token` prop, compare its `tenant_id` claim against the
      `tenantId` prop, and throw `AuditApiError('FORBIDDEN', ...)` on
      mismatch.

## 3. Validation

- [ ] 3.1 [docs] Document the `AuditApiError` taxonomy and the tenant-prop
      trust rule in `apps/console/README.md`.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/console test` and
      `openspec validate fix-l2-error-and-empty-states --strict`; both green.
