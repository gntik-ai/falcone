## MODIFIED Requirements

### Requirement: Canonical tenant invitation route accepts console member invitations

The control plane SHALL accept authenticated invitation creates with email, role and optional
workspaceId, return 202 with an id, a single-use token and expiry, and store only the token's SHA-256
and a keyed HMAC-SHA256 recipient identifier tagged with a key id. This supersedes the masked email,
hash-only emailHash input, and message persistence requirement from
`add-759-console-members-invite-wizard`. Raw or masked email and arbitrary request metadata/messages
SHALL NOT be persisted. HMAC material SHALL come from OpenBao through ExternalSecrets; missing key
material SHALL fail closed without an unkeyed fallback. The admin SHALL deliver the link out of band.

#### Scenario: Create returns proof once

- **WHEN** an authorized owner/admin submits an invitation
- **THEN** the response contains the one-time proof and seven-day expiry
- **AND** recipient hints and the raw token are absent from persisted data and audit payloads

#### Scenario: Hash-only input is refused

- **WHEN** a caller submits emailHash instead of an email
- **THEN** the request is refused without persistence

#### Scenario: Scoped workspace creation

- **WHEN** a workspace owner/admin creates an invitation
- **THEN** it grants only a workspace role within their verified workspace binding

## ADDED Requirements

### Requirement: Tenant invitation lifecycle

The system SHALL implement create, list, get, accept, revoke, resend and expiry. Reads SHALL return
only id, role, workspaceId, status (pending, accepted, revoked or expired), expiresAt and createdAt.
Tenant owners/admins SHALL read their tenant; workspace owners/admins SHALL read their own
workspaces. Other tenants SHALL receive 404 and unauthorized roles SHALL receive 403. Reads SHALL
never expose email identifiers, token or token hash. Pending rows past expiresAt SHALL report expired.

Acceptance SHALL compare token hashes and recipient HMACs in constant time, accept proof only in the
request body, and atomically claim an unexpired pending row with its token hash before changing
Keycloak. Acceptance SHALL require an active tenant; suspended, deleted or unknown tenant states
SHALL return the same generic invalid-invitation response with no identity or invitation changes.
Valid acceptance SHALL create or link the invitee, set emailVerified true, grant the invited
realm role and workspace binding, and set status accepted. Existing-account linking SHALL require
that account's authenticated tenant principal and SHALL NOT overwrite a foreign workspace binding.
Keycloak failure SHALL compensate granted access and mark the claim failed for explicit resend;
uncertain compensation SHALL keep the claim consumed. Failed rows SHALL be projected as expired.

Every successful create, revoke, resend and accept SHALL append an audit event of the corresponding
`iam.invitation.created`, `iam.invitation.revoked`, `iam.invitation.resent` or
`iam.invitation.accepted` type in the established durable audit-event stream. Payloads SHALL contain
no email or token. Identity-provider failure MAY additionally append `iam.invitation.failed`.

#### Scenario: Acceptance grants role and consumes proof

- **WHEN** a matching email presents a pending unexpired invitation token
- **THEN** exactly one acceptance succeeds, including simultaneous attempts
- **AND** the invited realm role and workspace binding are granted

#### Scenario: Invalid proof has no identity side effects

- **WHEN** proof is invalid, reused, expired, revoked, legacy or bound to another email
- **THEN** acceptance returns the same generic 4xx without creating a user, granting roles or changing the row

#### Scenario: Management and rotation

- **WHEN** an authorized admin revokes a pending invitation
- **THEN** the invitation is revoked and its proof cannot be accepted
- **WHEN** an admin re-enters the recipient and resends a pending, expired, revoked or failed invitation
- **THEN** the token rotates and expiry resets, with new proof returned once
- **AND** accepted invitations cannot be revoked or resent

#### Scenario: Reissue under a different HMAC key

- **WHEN** an authorized admin resends a legacy or old-key invitation whose recipient cannot be verified
- **THEN** the admin-supplied address becomes the recipient under the current HMAC key
- **AND** the invited role and workspace binding remain unchanged
- **AND** current-key invitations can only be resent to the matching recipient

#### Scenario: Inactive tenant cannot accept

- **WHEN** a valid pending invitation belongs to a tenant that is not active
- **THEN** acceptance returns the generic invalid-invitation 400 response
- **AND** no user is created or linked, no role is granted and the invitation remains unchanged

#### Scenario: Legacy migration

- **WHEN** schema setup migrates pending legacy invitations without token hashes
- **THEN** those pending rows are expired and every row's masked_email is NULL
- **AND** every row without email_hmac_key_id has email_hash replaced with an empty non-identifying placeholder
- **AND** keyed HMACs, including those tagged with old key ids, remain unchanged
- **AND** accepted and revoked rows retain their lifecycle state
- **AND** repeated migration makes no further invitation changes
- **AND** a final schema run after old writers drain scrubs any newly written legacy recipient hints

#### Scenario: Console administration and acceptance

- **WHEN** an admin opens Members
- **THEN** invitations including pending and expired rows are listed with revoke/resend actions
- **AND** create/resend show the link once
- **WHEN** an invitee opens that link
- **THEN** the public acceptance page submits the fragment proof only in the request body

### Requirement: Signup preserves invitation proof

Invitation-only signup SHALL reject requests without valid invitation proof with 403 and SHALL use
exactly the same acceptance path for valid proof. Public signup SHALL always create unverified users
and SHALL NOT grant roles from pending invitations. kc-admin createUser SHALL default emailVerified
to false and existing callers SHALL pass the flag explicitly.

The IAM admin create-user API SHALL treat emailVerified as opt-in (true only when explicitly
requested). Tenant-owner bootstrap and tenant-user creation SHALL explicitly leave email
unverified; the invitation path alone SHALL automatically verify ownership through proof.

#### Scenario: Invitation-only deployment

- **WHEN** SELF_SERVICE is false
- **THEN** signup without valid proof is refused and valid proof permits signup

#### Scenario: Public signup cannot claim invited privileges

- **WHEN** public signup uses an address with a pending invitation
- **THEN** the account is unverified, no invitation role is granted and the invitation remains pending

### Requirement: Tenant members expose realm roles

GET /v1/tenants/{tenantId}/users SHALL include each user's tenant realm roles.

#### Scenario: Role visibility

- **WHEN** an authorized tenant owner/admin lists members
- **THEN** each member includes their assigned realm role names
