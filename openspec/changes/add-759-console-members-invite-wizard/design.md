## Design

The existing invite wizard remains the single console implementation of the invitation flow. This
change mounts it from the Members route and adds the missing affordance.

`ConsoleMembersPage` already uses `useConsolePermissions().can('tenant.members.manage')` to gate the
direct-create action. `InviteUserWizard` independently delegates `invite_member` to the same
`tenant.members.manage` permission through `useWizardPermissionCheck`, so mounting the wizard behind
the page gate keeps both layers aligned without duplicating role lists.

The direct-create panel remains available because some administrators may still need to provision a
password-backed Keycloak user directly. The invite action is presented first because it is safer for
ordinary member onboarding: the owner supplies an email, role, and optional message, and the invitee
finishes activation through the invitation flow.

The wizard uses the canonical public invitation route:

```http
POST /v1/tenants/{tenantId}/invitations
```

with `email`, `role`, `message`, and the active `workspaceId` in the JSON body. The control-plane
runtime now registers that route in both `routes.mjs` and `route-map.runtime.json`, persists a
`tenant_invitations` row with masked email plus email hash, and returns the public
`MutationAccepted` envelope (`entityType: invitation`, `entityId: inv_*`). The handler accepts
tenant owner/admin callers for the tenant and workspace owner/admin callers only when the requested
workspace is present in their verified workspace binding.
