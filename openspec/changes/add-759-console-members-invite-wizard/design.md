## Design

The existing invite wizard remains the single implementation of the invitation flow. This change only
mounts it from the Members route and adds the missing affordance.

`ConsoleMembersPage` already uses `useConsolePermissions().can('tenant.members.manage')` to gate the
direct-create action. `InviteUserWizard` independently delegates `invite_member` to the same
`tenant.members.manage` permission through `useWizardPermissionCheck`, so mounting the wizard behind
the page gate keeps both layers aligned without duplicating role lists.

The direct-create panel remains available because some administrators may still need to provision a
password-backed Keycloak user directly. The invite action is presented first because it is safer for
ordinary member onboarding: the owner supplies an email, role, and optional message, and the invitee
finishes activation through the invitation flow.

No contract changes are required. The existing wizard already posts:

```http
POST /v1/workspaces/{workspaceId}/invitations
```

with `email`, `role`, and `message`; this change does not add, remove, or rename any request or
response fields.
