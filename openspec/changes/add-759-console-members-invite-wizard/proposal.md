## Why

Issue #759 confirmed that `/console/members` only exposed the direct password-create path
(`Crear usuario` + `CreateUserPanel`) even though the invite-by-email wizard already existed and
submitted `POST /v1/workspaces/{workspaceId}/invitations`. Tenant/workspace administrators therefore
had to set an initial password to add a member from the Members route, instead of using the email
invitation flow.

## What Changes

- Mount the existing `InviteUserWizard` from `ConsoleMembersPage`.
- Add an `Invitar usuario` action on `/console/members` for principals allowed by the existing
  `tenant.members.manage` / `invite_member` permission gate (`tenant_owner`, `tenant_admin`,
  `workspace_owner`, `workspace_admin`, plus platform bypass roles).
- Keep direct `Crear usuario` available as a secondary path for the same authorized principals.
- Hide both member-management actions for read-only roles and keep the existing read-only indicator.
- Add focused page tests that open the wizard from Members, submit an invitation payload with
  email/role/message, and assert the flow never requires or posts a password.
- Update the Members permission architecture documentation.

## Capabilities

### Modified Capabilities

- `web-console`: ADDED requirement for `/console/members` to expose the invite-by-email member
  action through the existing invite wizard and permission matrix.

## Non-Goals

- No backend behavior change.
- No OpenAPI/AsyncAPI/SDK/generated-client change; the wizard already uses the existing
  `/v1/workspaces/{workspaceId}/invitations` endpoint.
- No change to the direct password-create user API or form beyond keeping it as a secondary action.

## Exit Criteria

- Authorized principals see `Invitar usuario` on `/console/members` and can open/submit the wizard.
- The invite flow does not display, require, or post a password.
- Read-only principals still see no member-management action and receive the read-only indicator.
- `pnpm --dir apps/web-console test src/pages/ConsoleMembersPage.test.tsx` and
  `openspec validate add-759-console-members-invite-wizard --strict` pass.

## Risks and Rollback

- Risk is limited to the Members page action surface. The wizard, endpoint, request shape, and
  permission helper already existed.
- Rollback is removing the `InviteUserWizard` mount and `Invitar usuario` button from
  `ConsoleMembersPage` while leaving the existing direct-create path intact.
