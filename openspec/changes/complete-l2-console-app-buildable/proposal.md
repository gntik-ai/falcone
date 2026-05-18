## Why

The `apps/console/` directory ships eight TypeScript/TSX source files but no
build chain — the L2 capability literally cannot run. From
`openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B1** (`apps/console/` — verified by `ls -la`) — the directory contains only
  `src/`. No `package.json`, no `tsconfig.json`, no `vite.config.ts`, no
  `index.html`, no router, no test runner config. `npm install` has no target;
  `vite build` has nothing to consume; no entry point exists.
- **G1** (`apps/console/src/hooks/useAuditEvents.ts:5`) — imports
  `@tanstack/react-query` with no `package.json` in this directory to declare
  the dependency. Any sibling app that builds these sources must lend its own
  dependency tree.
- **G2** (`apps/console/`, no tests) — empty test surface. No contract test
  asserts the API client matches the L1 backend's `/v1/backup/audit` route.

## What Changes

- Add `apps/console/package.json` declaring `react`, `react-dom`,
  `react-router-dom`, `@tanstack/react-query`, and dev-deps (`vite`,
  `@vitejs/plugin-react`, `typescript`, `vitest`).
- Add `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`,
  `src/App.tsx`, and a router that maps `/backup-audit` and
  `/backup-audit-summary/:tenantId` to the two existing pages.
- Add `vitest.config.ts` and a smoke test that mounts `<BackupAuditPage>` with
  a mocked fetch to prove the build chain compiles and tests run.
- Document the build commands (`pnpm install`, `pnpm dev`, `pnpm build`,
  `pnpm test`) in a new `apps/console/README.md`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: console application buildability, router wiring, and
  test runner contract.

## Impact

- **Affected code**: new `apps/console/{package.json, tsconfig.json,
  vite.config.ts, vitest.config.ts, index.html}`,
  `apps/console/src/{main.tsx, App.tsx, router.tsx}`,
  `apps/console/src/pages/admin/BackupAuditPage.test.tsx` (smoke test).
- **Migration required**: none (no schema changes); CI must add an
  `apps/console` workspace entry to `pnpm-workspace.yaml`.
- **Breaking changes**: none — the directory was unbuildable, so no consumer
  exists.
- **Out of scope**: porting the components into `apps/web-console/` (an
  alternative discussed in the audit's Scope Note); replacing cross-service
  relative imports (handled by `fix-l2-cross-service-imports`).
