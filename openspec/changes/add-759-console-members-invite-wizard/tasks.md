## 1. Confirm Baseline and Scope

- [x] 1.1 Confirm root cause: `ConsoleMembersPage.tsx` rendered only `Crear usuario` and
  `CreateUserPanel`; `InviteUserWizard` existed but was not mounted by the Members route.
- [x] 1.2 Confirm no wire/API change is needed: the existing wizard submits
  `/v1/workspaces/{workspaceId}/invitations`.

## 2. Implement

- [x] 2.1 `apps/web-console/src/pages/ConsoleMembersPage.tsx`: import and mount
  `InviteUserWizard` behind the existing `tenant.members.manage` gate.
- [x] 2.2 Add an `Invitar usuario` CTA and keep `Crear usuario` as a secondary direct-create path.
- [x] 2.3 Ensure opening one member-management action closes the other, so the page does not show a
  direct-create panel under the invite modal.
- [x] 2.4 Keep read-only roles denied through the existing `ReadOnlyActionBadge` affordance.

## 3. Tests

- [x] 3.1 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: authorized roles
  (`tenant_owner`, `tenant_admin`, `workspace_owner`, `workspace_admin`) see both member-management
  actions.
- [x] 3.2 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: read-only roles
  (`tenant_viewer`, `tenant_developer`) see neither action and still see the read-only indicator.
- [x] 3.3 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: opening `Invitar usuario` from
  Members drives the real wizard to submit an invitation email payload without a password field.

## 4. Docs / OpenSpec / Validation

- [x] 4.1 Add this OpenSpec change and web-console spec delta.
- [x] 4.2 Update `docs/reference/architecture/console-permission-aware-tenant-roles.md` for the
  Members invite action.
- [x] 4.3 Run focused web-console test, OpenSpec strict validation, and `git diff --check`.
