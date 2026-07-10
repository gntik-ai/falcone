## 1. Encode issue #772 scenarios

- [x] 1.1 Confirm the pre-fix issue still reproduces on current `origin/main` and the deployed
  console bundle.
  - Evidence: independent verifier returned `VERDICT_BEFORE=CONFIRMED` on source commit `688eee6c`
    and live bundle `/assets/index-DIL6tGwe.js`.
- [x] 1.2 Add focused test coverage for two-field create validation with per-field
  `aria-invalid` / `aria-describedby`.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.test.tsx`.
- [x] 1.3 Add focused test coverage for referenced-secret and production-workspace delete
  confirmation using the shared destructive dialog.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.test.tsx`.
- [x] 1.4 Add/update focused assertions for shared table usage, non-`min-w-[64rem]` layout,
  row/table-local success feedback, and stage-badge helper classes.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.test.tsx`.

## 2. Implement the frontend hardening

- [x] 2.1 Extend `useDestructiveOp.openDialog` to accept caller-provided static cascade-impact
  summaries while preserving existing fetch-based impact loading for supported resource types.
  - Paths: `apps/web-console/src/components/console/hooks/useDestructiveOp.ts`,
    `apps/web-console/src/components/console/hooks/useDestructiveOp.test.ts`.
- [x] 2.2 Route Workspace Secrets deletion through `DestructiveConfirmationDialog`, requiring
  type-to-confirm for referenced secrets and production workspaces and showing the function reference
  count as cascade impact.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`.
- [x] 2.3 Split create validation state per field and associate each error with its input.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`.
- [x] 2.4 Move replace/delete success feedback out of the create card and near the affected
  table/list region.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`.
- [x] 2.5 Add Workspace Secrets in-page breadcrumbs, reuse the status badge helper, and render the
  metadata list with the shared table primitive.
  - Path: `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`.

## 3. Documentation and OpenSpec

- [x] 3.1 Add this OpenSpec proposal, tasks, and web-console spec delta.
  - Paths: `openspec/changes/harden-workspace-secrets-console-ux/`.
- [x] 3.2 Update the Workspace Secrets architecture note for the hardened console behavior.
  - Path: `docs/reference/architecture/workspace-secrets-console.md`.

## 4. Verify

- [x] 4.1 Run the focused Workspace Secrets web-console tests.
  - `pnpm --filter @in-falcone/web-console exec vitest run src/components/console/hooks/useDestructiveOp.test.ts src/pages/ConsoleWorkspaceSecretsPage.test.tsx`
    passed: 2 files / 28 tests.
- [x] 4.2 Run `openspec validate harden-workspace-secrets-console-ux --strict`.
  - Passed: `Change 'harden-workspace-secrets-console-ux' is valid`.
- [x] 4.3 Run public API generation and confirm no tracked generated contract diff.
  - `npm run generate:public-api` passed and left no tracked generated diff.
- [ ] 4.4 Run independent post-fix verifier and reviewer gates.
