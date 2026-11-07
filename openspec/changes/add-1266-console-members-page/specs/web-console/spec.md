## ADDED Requirements

### Requirement: Complete isolated members directory

The next console SHALL serve the migrated members route without a role guard.
The realm SHALL come from the active tenant's identityContext.consoleUserRealm.
The resource-index composition SHALL use the pinned kit and es/en namespace.

#### Scenario: Load all users and roles

- **WHEN** an active tenant has a realm
- **THEN** users SHALL request page[size]=100, then page[after] until null.
- **AND** overlapping userIds SHALL render once, without pagination controls.
- **AND** users SHALL remain a skeleton through every continuation; roles SHALL
  load independently with page[size]=100.
- **WHEN** a continuation fails or repeats a cursor
- **THEN** users SHALL show an error with no partial rows, leaving roles intact;
  retry SHALL start without page[after].
- **WHEN** tenant changes during loading
- **THEN** previous rows and pending results SHALL never enter the new tenant.
- **WHEN** tenant or realm is absent
- **THEN** the legacy empty message SHALL render without IAM or invitations calls.

#### Scenario: Section failures

- **WHEN** an IAM list returns 403
- **THEN** only that section SHALL show no-access.
- **WHEN** either list returns any 404
- **THEN** that section SHALL show not-found and a link to `/console/overview`.
- **WHEN** a list fails with 5xx or a network error
- **THEN** it SHALL show localized service-unavailable or section fallback copy,
  request ID when available and section-only retry, without stale rows.
- **WHEN** a request returns 401
- **THEN** unchanged session primitives SHALL refresh once and replay once;
  another 401 SHALL clear the session and redirect to login with return intent.

### Requirement: Permission-gated account and invitation lifecycle

Management controls and invitation listing SHALL require shell
tenant.members.manage. The read-only indicator SHALL expose highest role and
denial reason. Backend authorization remains authoritative.

#### Scenario: Create account

- **WHEN** Create user opens
- **THEN** username SHALL focus, password SHALL use kit PasswordInput, initial
  role SHALL default to tenant_developer and exclude default-roles options.
- **WHEN** submitted with nonempty trimmed username and password
- **THEN** one POST `/v1/tenants/{tenantId}/users` SHALL contain trimmed values,
  optional nonempty email and roles array, followed by a users reload on success.
- **WHEN** it fails
- **THEN** values SHALL remain, 403 SHALL show role-aware permission denial,
  5xx SHALL use shared localized service copy and network SHALL use legacy fallback.
- **AND** success SHALL clear password, announce completion and restore toggle focus.

#### Scenario: Four-step focused invitation

- **WHEN** Invite user opens
- **THEN** persisted session permissions SHALL be checked again; denial SHALL show
  Access blocked without metrics or mutation requests.
- **AND** an allowed opening SHALL focus the wizard heading, retain the members URL
  and issue the tenant/workspace quotas and overview GETs once each.
- **AND** the kit stepper SHALL list workspace, email, role and summary only.
- **WHEN** Next is activated
- **THEN** it SHALL validate only that step and mark/announce errors, remaining
  enabled for validation. Workspace is read-only and required; email SHALL match
  one address; role SHALL be viewer, developer or admin at workspace scope.
- **AND** pending or exhausted members.count quota SHALL prevent email advancement;
  metrics failure SHALL fail open as legacy does.
- **WHEN** summary Edit is activated
- **THEN** it SHALL return to the corresponding step with values retained.
- **WHEN** Finish is activated, including double activation
- **THEN** one POST `/v1/tenants/{tenantId}/invitations` SHALL send exactly email,
  role and workspaceId with idempotent=true and a wiz X-Request-Id.
- **AND** failure SHALL retain the summary/values, focus Finish and announce only
  localized error copy, without automatic resubmission beyond the shared 401 replay.
- **AND** success SHALL display the one-time link and expiry without Finish.

#### Scenario: Invitation list and proof cleanup

- **WHEN** a manager loads the page or closes the wizard
- **THEN** one invitations GET SHALL load the table with invitation ID, role,
  workspace, status, expiry and actions.
- **AND** Revocar SHALL exist only for pending rows and POST revocation with `{}`
  without confirmation; Reenviar SHALL be absent for accepted rows and POST resend
  with `{email}`. Successful mutations SHALL refetch invitations.
- **WHEN** listing fails
- **THEN** no rows SHALL remain, with legacy localized error and retry.
- **WHEN** revoke or resend fails
- **THEN** rows SHALL remain with the corresponding legacy localized message.
- **WHEN** a proof is displayed
- **THEN** its link SHALL retain origin/invitations/tenant/id#token form and SHALL
  never enter storage, a query string, toast, announcer or console.
- **AND** Close, Hide link, tenant change and unmount SHALL remove it.
- **AND** wizard Exit, Escape and Close SHALL restore Invite user focus and reload
  invitations, without creating another invitation.

### Requirement: Rollback and parity verification

The members migration SHALL support rollback to legacy navigation and mocked
parity verification in both locales at every required viewport.

#### Scenario: Disable migration

- **WHEN** the members migrated flag is removed
- **THEN** `/next/console/members` SHALL render pendingPage without members calls
  and shell navigation SHALL use a plain legacy href.

#### Scenario: Mocked and visual coverage

- **WHEN** parity runs in es/en at 375, 768 and 1280 px
- **THEN** it SHALL cover data, actions, states, accessibility, runtime health,
  responsive overflow, kit conformance and visual-review.
- **AND** only page-list requests, shell bootstrap and 401 auth refresh SHALL occur.
- **AND** visual states SHALL include manager, read-only, create panel, every invite
  step, blocked invite, failed summary and users error with the approved fixtures.
- **AND** local review SHALL assess visual specs and fixtures; missing sandbox
  screenshots SHALL not block it. CI captures baselines for operator review.
