## Why

Issue #759 confirmed that `/console/members` only exposed the direct password-create path
(`Crear usuario` + `CreateUserPanel`) even though the invite-by-email wizard already existed and
was intended to submit an invitation flow. Tenant/workspace administrators therefore had to set an
initial password to add a member from the Members route, instead of using email invitation
onboarding.

## What Changes

- Mount the existing `InviteUserWizard` from `ConsoleMembersPage`.
- Add an `Invitar usuario` action on `/console/members` for principals allowed by the existing
  `tenant.members.manage` / `invite_member` permission gate (`tenant_owner`, `tenant_admin`,
  `workspace_owner`, `workspace_admin`, plus platform bypass roles).
- Keep direct `Crear usuario` available as a secondary path for the same authorized principals.
- Hide both member-management actions for read-only roles and keep the existing read-only indicator.
- Retarget the wizard to the canonical public route `POST /v1/tenants/{tenantId}/invitations` with
  `workspaceId` in the body, and add the missing deployed control-plane local handler for that route.
- Add focused page tests that open the wizard from Members, submit an invitation payload with
  email/role/message, and assert the flow never requires or posts a password.
- Add a control-plane route/handler regression test so the invite flow cannot regress to a
  catalog-only or mocked-only endpoint.
- Update the Members permission architecture documentation.

## Capabilities

### Modified Capabilities

- `web-console`: ADDED requirement for `/console/members` to expose the invite-by-email member
  action through the existing invite wizard and permission matrix.
- `iam`: ADDED requirement for the canonical tenant invitation route to accept console member
  invitations and persist masked/hash invitation records.

## Non-Goals

- No change to the direct password-create user API or form beyond keeping it as a secondary action.
- No email delivery implementation; this change records the invitation request and returns the public
  mutation-accepted response shape.

## Exit Criteria

- Authorized principals see `Invitar usuario` on `/console/members` and can open/submit the wizard.
- The invite flow does not display, require, or post a password.
- Read-only principals still see no member-management action and receive the read-only indicator.
- `pnpm --dir apps/web-console test src/pages/ConsoleMembersPage.test.tsx` and
  `openspec validate add-759-console-members-invite-wizard --strict` pass.

## Risks and Rollback

- Risk is limited to the Members page action surface and the tenant invitation POST route. The
  handler is additive, stores only masked email plus hash, and is gated by verified tenant/workspace
  scope.
- Rollback is removing the `InviteUserWizard` mount and `Invitar usuario` button from
  `ConsoleMembersPage` and removing the additive invitation route while leaving the existing
  direct-create path intact.
