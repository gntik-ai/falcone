## 1. Failing tests

- [ ] 1.1 [test] Add `apps/console/src/pages/admin/BackupAuditPage.test.tsx`
      mounting `<BackupAuditPage token="t" />` with a mocked `fetch`; assert
      the page renders an `<h1>` and that the test runner actually executes
      (proves the entire build/test chain is wired, addressing B1/G2).

## 2. Implementation

- [ ] 2.1 [impl] Add `apps/console/package.json` declaring `react`,
      `react-dom`, `react-router-dom`, `@tanstack/react-query`, `vite`,
      `@vitejs/plugin-react`, `typescript`, `vitest`, and `@testing-library/react`
      (addresses B1, G1).
- [ ] 2.2 [impl] Add `apps/console/tsconfig.json`, `vite.config.ts`,
      `vitest.config.ts`, and `index.html` so `vite build`, `vite dev`, and
      `vitest run` succeed against the existing `src/` tree.
- [ ] 2.3 [impl] Add `apps/console/src/main.tsx`, `src/App.tsx`, and
      `src/router.tsx` mapping `/backup-audit` to `<BackupAuditPage>` and
      `/backup-audit-summary/:tenantId` to `<BackupAuditSummaryPage>`.
- [ ] 2.4 [impl] Wrap `<App>` in `<QueryClientProvider>` with a single
      `QueryClient` instance, satisfying the `useInfiniteQuery` import in
      `hooks/useAuditEvents.ts:5`.
- [ ] 2.5 [migration] Register `apps/console` in `pnpm-workspace.yaml` so the
      monorepo installer wires the new package.

## 3. Validation

- [ ] 3.1 [docs] Add `apps/console/README.md` documenting `pnpm install`,
      `pnpm dev`, `pnpm build`, `pnpm test`, and the router URL layout.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/console build`,
      `pnpm --filter @in-falcone/console test`, and
      `openspec validate complete-l2-console-app-buildable --strict`; all green.
