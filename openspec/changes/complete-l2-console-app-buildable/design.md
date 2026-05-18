## Goals

1. `apps/console/` builds with `vite build`, dev-runs with `vite dev`, and
   tests with `vitest run` from a single `pnpm install` at the monorepo root.
2. The two existing pages (`pages/admin/BackupAuditPage.tsx`,
   `pages/tenant/BackupAuditSummaryPage.tsx`) are reachable via real URLs.
3. Existing source files are not rewritten — the change is additive scaffolding.

## Non-goals

- **Porting into `apps/web-console/`** — the audit Scope Note lists this as an
  alternative; this change picks the "keep `apps/console/` standalone" branch.
  If a future change folds the components into `web-console`, this scaffolding
  is removed at that time.
- **Fixing the components themselves** — bugs in the table, filters, and pages
  are the subject of sibling proposals (`fix-l2-event-types-and-filter-bugs`,
  `fix-l2-error-and-empty-states`, `harden-l2-a11y-and-i18n`,
  `harden-l2-query-perf-and-aborts`, `fix-l2-cross-service-imports`).
- **Authoring an end-to-end test against a live backend** — the smoke test
  uses a mocked `fetch`. E2E is deferred until the backend's audit API is
  contract-tested under L1.

## Build chain choice: Vite + Vitest

- The sibling `apps/web-console/` uses Vite, so picking Vite here keeps the
  monorepo on one bundler.
- Vitest reads `vite.config.ts` directly — no second build config.
- React 19 typings ship with `@types/react@19`; `tsconfig.json` targets
  `ESNext` + `bundler` moduleResolution to match the sibling app.

## Router topology

```
/                                 → redirect to /backup-audit
/backup-audit                     → <BackupAuditPage token={fromContext()} />
/backup-audit-summary/:tenantId   → <BackupAuditSummaryPage token={...} tenantId={params.tenantId} />
```

The `token` is sourced from a `<TokenContext>` provider in `App.tsx` that
reads a JWT from `localStorage` (dev) or from a session cookie (prod). The
provider is a stub at this layer — real auth wiring is deferred to a
follow-up change.

## QueryClient configuration

A single `QueryClient` lives at the `<App>` root:

```ts
new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
```

The defaults are conservative; the `harden-l2-query-perf-and-aborts` change
revisits per-hook configuration.

## Test runner

A single smoke test under `pages/admin/BackupAuditPage.test.tsx` mounts the
page with a mocked `fetch` returning an empty `pagination`. The test asserts
the heading renders and that `useInfiniteQuery` does not throw. The intent is
to prove the build chain is alive — not to cover behaviour, which is the
subject of later L2 proposals.

## Out-of-scope notes

This change does not introduce error or empty states (covered by
`fix-l2-error-and-empty-states`), does not fix the dead admin operation link
(`harden-l2-a11y-and-i18n`), and does not address the
`@tanstack/react-query` cross-service import path resolution beyond declaring
the dependency at this package's manifest.
