# web-console — spec delta for add-759-console-members-invite-wizard

## ADDED Requirements

### Requirement: Members page invite-by-email action

The system SHALL surface an `Invitar usuario` invite-by-email action on `/console/members` for
principals authorized by the `invite_member` permission / `tenant.members.manage`
(`tenant_owner`, `tenant_admin`, `workspace_owner`, `workspace_admin`, and platform bypass roles),
in addition to the secondary direct password-create path where available. The action SHALL open the
existing invite wizard and SHALL NOT require the owner to set a password for the invited user.
Principals denied `tenant.members.manage` SHALL NOT see either member-management action and SHALL see
the role-aware read-only indicator instead.

#### Scenario: Authorized owner submits an invitation without a password

- **WHEN** an authorized owner opens `/console/members` and chooses `Invitar usuario`
- **THEN** the existing invite wizard opens and can submit an invitation email flow to
  `/v1/tenants/{tenantId}/invitations` with email/role/message and the active `workspaceId`,
  without displaying, requiring, or posting a password

#### Scenario: Read-only role cannot access member-management actions

- **WHEN** a principal denied `tenant.members.manage` opens `/console/members`
- **THEN** the page hides both `Invitar usuario` and `Crear usuario` and shows the read-only
  member-management indicator
