## 1. Reproduce / Encode The Issue

- [x] 1.1 Parse issue #738 acceptance criteria:
  - Requirement: route `workspaceId` restores active workspace context when present, subject to
    access.
  - Scenario: direct open/refresh of `/console/workspaces/{id}` by a tenant owner shows that
    workspace active in the header and loads the workspace page with context.
- [x] 1.2 Identify the root cause: `ConsoleContextProvider` selected only persisted or single-option
  context and did not consume the matched route `workspaceId`.
- [x] 1.3 Add regression tests for fresh deep-link workspace restoration and inaccessible route
  workspace behavior.

## 2. Web Console

- [x] 2.1 Pass the matched `workspaceId` route parameter from `ConsoleShellLayout` into
  `ConsoleContextProvider`.
- [x] 2.2 Resolve a route workspace against existing accessible tenant/workspace APIs.
- [x] 2.3 Select the tenant that owns the accessible route workspace before selecting the workspace.
- [x] 2.4 Do not select or persist an inaccessible route workspace.
- [x] 2.5 Do not fall back to an unrelated persisted or auto-selected workspace while a route
  workspace id is present but inaccessible.

## 3. Specs And Docs

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-738-workspace-route-context/`.
- [x] 3.2 Add a web-console MODIFIED requirement for route-derived workspace context.
- [x] 3.3 Add a short docs reference note for console workspace deep-link behavior.
- [x] 3.4 Leave backend, OpenAPI, generated SDKs, and shared wire types unchanged because no wire
  contract changes are required.

## 4. Verification

- [x] 4.1 Run focused web-console tests for the shell/provider route-context behavior.
- [ ] 4.2 Run web-console typecheck if dependencies are available.
  Blocked in this worktree: `pnpm --filter @in-falcone/web-console typecheck` fails on existing
  unrelated TypeScript errors in backup, plan, router dependency, IAM/member payload, and secrets
  files before this change can get a clean full-project typecheck.
- [x] 4.3 Run OpenSpec validation if the CLI is available.
- [x] 4.4 Run `git diff --check`.
