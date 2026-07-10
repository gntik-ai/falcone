## 1. Confirm Baseline and Scope

- [x] 1.1 Confirm root cause: `ConsoleMembersPage.tsx` rendered only `Crear usuario` and
  `CreateUserPanel`; `InviteUserWizard` existed but was not mounted by the Members route.
- [x] 1.2 Confirm wire mismatch: the wizard used `/v1/workspaces/{workspaceId}/invitations`, while
  the checked-in public contract exposes `/v1/tenants/{tenantId}/invitations`.

## 2. Implement

- [x] 2.1 `apps/web-console/src/pages/ConsoleMembersPage.tsx`: import and mount
  `InviteUserWizard` behind the existing `tenant.members.manage` gate.
- [x] 2.2 Add an `Invitar usuario` CTA and keep `Crear usuario` as a secondary direct-create path.
- [x] 2.3 Ensure opening one member-management action closes the other, so the page does not show a
  direct-create panel under the invite modal.
- [x] 2.4 Keep read-only roles denied through the existing `ReadOnlyActionBadge` affordance.
- [x] 2.5 Retarget `InviteUserWizard` to `POST /v1/tenants/{tenantId}/invitations` and include the
  active `workspaceId` in the body.
- [x] 2.6 Add the deployed control-plane local handler, runtime route-map entry, and durable
  `tenant_invitations` storage for invitation submissions.

## 3. Tests

- [x] 3.1 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: authorized roles
  (`tenant_owner`, `tenant_admin`, `workspace_owner`, `workspace_admin`) see both member-management
  actions.
- [x] 3.2 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: read-only roles
  (`tenant_viewer`, `tenant_developer`) see neither action and still see the read-only indicator.
- [x] 3.3 `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`: opening `Invitar usuario` from
  Members drives the real wizard to submit an invitation email payload without a password field.
- [x] 3.4 `tests/unit/tenant-invitation-route.test.mjs`: the canonical invitation route resolves in
  seed/runtime route maps and persists masked/hash invitation records with tenant/workspace gating.

## 4. Docs / OpenSpec / Validation

- [x] 4.1 Add this OpenSpec change and web-console spec delta.
- [x] 4.2 Update `docs/reference/architecture/console-permission-aware-tenant-roles.md` for the
  Members invite action.
- [x] 4.3 Update OpenAPI/public route artifacts for the console invitation body and
  `MutationAccepted(entityType=invitation)`.
- [x] 4.4 Run focused web-console test, control-plane unit test, OpenSpec strict validation,
  public API generation, and `git diff --check`.
