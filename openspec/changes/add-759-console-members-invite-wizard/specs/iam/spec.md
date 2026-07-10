# iam - spec delta for add-759-console-members-invite-wizard

## ADDED Requirements

### Requirement: Canonical tenant invitation route accepts console member invitations

The control-plane runtime SHALL serve `POST /v1/tenants/{tenantId}/invitations` for authenticated
member-management principals. The route SHALL accept the console invite payload with `email`, `role`,
`message`, and `workspaceId`; persist a durable invitation record without storing the raw email
address; persist only the masked email plus email hash for the invitee; derive invitation
`targetBindings` from the verified tenant/workspace scope and requested role; and return a
`MutationAccepted` response whose `entityType` is `invitation` and whose `entityId` identifies the
created invitation.

Tenant owner/admin principals SHALL be allowed to create invitations for their tenant. Workspace
owner/admin principals SHALL be allowed only when the requested `workspaceId` belongs to the tenant
and is present in the principal's verified workspace binding.

The route SHALL NOT trust caller-supplied email, masked email, or binding-shaped fields in
invitation metadata. For hash-only requests, caller-supplied `emailHash` SHALL be accepted only
when it is a valid SHA-256 hex digest; when a raw `email` is present, the route SHALL derive the
persisted hash from that email instead of trusting a supplied `emailHash`. It SHALL persist only
server-whitelisted metadata, including the sanitized `message` when present, and SHALL NOT persist
caller-supplied `metadata.email`, `metadata.maskedEmail`, or `metadata.targetBindings`.

#### Scenario: Tenant owner submits a workspace invitation

- **WHEN** a tenant owner calls `POST /v1/tenants/{tenantId}/invitations` with email/role/message and
  a workspace id owned by that tenant
- **THEN** the route persists a pending invitation with masked email plus email hash and returns
  `202 MutationAccepted` with `entityType: invitation`

#### Scenario: Workspace admin is bound to the target workspace

- **WHEN** a workspace admin calls the same route with a `workspaceId` that is present in their
  verified workspace binding
- **THEN** the invitation is accepted

#### Scenario: Workspace admin is not bound to the target workspace

- **WHEN** a workspace admin calls the same route with a different `workspaceId`
- **THEN** the route rejects the request with 403 and does not persist an invitation

#### Scenario: Caller metadata cannot smuggle invitee email or bindings

- **WHEN** an authorized principal calls the same route with `metadata.email`,
  `metadata.maskedEmail`, and `metadata.targetBindings` containing raw invitee email or cross-scope
  binding references
- **THEN** the route accepts the invitation only with server-derived masked/hash email,
  server-derived `targetBindings`, and server-whitelisted message metadata

#### Scenario: Caller emailHash cannot store raw email

- **WHEN** an authorized principal calls the same route with an `emailHash` value that is not a
  SHA-256 hex digest, including a raw email address
- **THEN** the route rejects the request and does not persist an invitation
