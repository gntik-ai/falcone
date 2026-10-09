## Why

Issue #975 reproduced a write-only invitation: the route table has POST but no read, acceptance,
revocation or resend operations. Signup ignores invitations and Keycloak creation verifies email
by default. The #759 masked-email and caller-supplied unkeyed hash requirements also leave invitees
open to offline enumeration.

## What Changes

- Replace the #759 hash-only/masked-email requirement with server-keyed HMAC-SHA256 recipient
  identifiers, a key id, and no persisted email hints or free-form invitation messages.
- Create and resend return a 256-bit random single-use token and seven-day expiry once, for admin
  delivery out of band. Links carry the token in a fragment; acceptance reads only the POST body.
- Add scoped list/get/revoke/resend/accept routes. A conditional PostgreSQL UPDATE claims an
  unexpired pending invitation before any Keycloak mutation. Failures compensate and require resend.
- Link existing accounts only as the authenticated principal in the invited tenant. Preserve
  existing workspace isolation and pre-existing roles during compensation.
- Route invitation-only signup through acceptance; public signup and default Keycloak creation
  leave email unverified. Tenant-user collections include realm roles.
- Add additive schema migration, safe lifecycle IAM audit events, console invitation management,
  and a public acceptance page. Publish the tenant-addressed invitation operations in IAM discovery
  while preserving their tenant gateway/authorization family.

## Capabilities

### Modified Capabilities

- `iam`: supersede the invitation write requirement introduced by
  `add-759-console-members-invite-wizard`; add lifecycle and proof requirements.

## Delivery Boundary

This source change does not deliver SMTP, change unrelated routes, deploy, or run live migrations.
The deployment maker must provide `INVITATION_EMAIL_HMAC_KEY` (at least 32 bytes) and
`INVITATION_EMAIL_HMAC_KEY_ID` through OpenBao-backed ExternalSecrets, with required secret refs
and immutable image digests. Missing keys make invitation routes return 503, with no hash fallback.

## Risks and Rollback

Legacy rows without token hashes become expired and all masked emails are cleared.
Administrators re-enter the recipient when resending; after key rotation, old proofs cannot be
accepted and must be explicitly reissued. Failed identity-provider compensation retains a consumed
claim to prevent duplicate grants. Additive columns remain compatible with the previous image;
expired legacy rows remain expired on rollback.
