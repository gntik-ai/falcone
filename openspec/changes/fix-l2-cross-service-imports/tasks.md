## 1. Failing tests

- [ ] 1.1 [test] Add an ESLint test that fails when any file under
      `apps/console/src/` imports a path matching
      `../../../../services/...`, proving B7 and G3 from the four cited
      files.

## 2. Implementation

- [ ] 2.1 [impl] Create `packages/backup-audit-types/package.json` and
      `src/index.ts` re-exporting every type currently defined in
      `services/backup-status/src/audit/audit-trail.types.ts`.
- [ ] 2.2 [migration] Add the package to `pnpm-workspace.yaml`; install at
      the repo root.
- [ ] 2.3 [fix] Replace the cross-service import in
      `apps/console/src/components/backup/AuditEventTable.tsx` with
      `import type { ... } from '@in-falcone/backup-audit-types'`.
- [ ] 2.4 [fix] Repeat 2.3 for
      `apps/console/src/components/backup/AuditEventDetail.tsx`,
      `apps/console/src/components/backup/AuditEventTypeBadge.tsx`, and
      `apps/console/src/lib/api/backup-audit.api.ts`.
- [ ] 2.5 [impl] Add `eslint-plugin-import` `no-restricted-paths` rule in
      `apps/console/.eslintrc.cjs` forbidding `../../../../services/*`
      imports.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/console lint`,
      `pnpm --filter @in-falcone/console build`, and
      `openspec validate fix-l2-cross-service-imports --strict`; all green.
