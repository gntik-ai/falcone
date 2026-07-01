## 1. Reproduce / Encode The Issue

- [x] 1.1 Parse issue #770 acceptance criteria:
  - Requirement: tenant-selection events must leave the workspace selector consistent and never
    permanently empty without reload.
  - Scenario 1: same active tenant selection preserves or refetches workspaces.
  - Scenario 2: empty workspace lists offer retry even without `workspacesError`.
- [x] 1.2 Identify the root cause: `selectTenant` cleared workspace state while resetting
  `workspaceReloadKey` to its current value for same-tenant selections, so the loader did not
  re-run.
- [x] 1.3 Add regression tests for unchanged-tenant reselection, empty-list refetch, and empty-list
  retry.

## 2. Web Console

- [x] 2.1 Make unchanged tenant selection preserve the existing workspace list and active workspace.
- [x] 2.2 Refetch workspaces for an unchanged active tenant when the workspace list is already empty
  or has an error.
- [x] 2.3 Keep changed-tenant behavior intact: clear the previous workspace selection and load the
  new tenant's workspaces through the existing loader.
- [x] 2.4 Render `Reintentar workspaces` when an active tenant's workspace list is empty and not
  loading, not only when `workspacesError` is present.

## 3. Specs And Docs

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-770-tenant-reselect-workspaces/`.
- [x] 3.2 Add a web-console MODIFIED requirement for tenant/workspace context consistency.
- [x] 3.3 Add a short docs reference note for console tenant/workspace context behavior.
- [x] 3.4 Leave backend, OpenAPI/AsyncAPI, generated SDKs, shared wire types, and route catalog
  unchanged because no wire contract changes are required.

## 4. Verification

- [x] 4.1 Run focused web-console provider/layout tests for issue #770.
- [ ] 4.2 Run web-console typecheck if dependencies are available.
  Blocked in this worktree: `pnpm --filter @in-falcone/web-console typecheck` fails on existing
  unrelated TypeScript errors in backup, plan, router dependency, IAM/member payload, and secrets
  files before this change can get a clean full-package typecheck.
- [x] 4.3 Run OpenSpec validation if the CLI is available.
- [x] 4.4 Run `git diff --check`.
