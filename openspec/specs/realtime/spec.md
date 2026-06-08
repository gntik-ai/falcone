# realtime Specification

## Purpose
TBD - created by archiving change fix-realtime-refresh-identity-stability. Update Purpose after archive.
## Requirements
### Requirement: refreshToken MUST reject tokens whose tenant does not match the session

The system SHALL verify that `claims.tenant_id` in the new Bearer token equals `session.tenantId` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch, without mutating any session state.

#### Scenario: Cross-tenant token rejected on refresh (bbx-refresh-tenant-drift)

- **WHEN** a caller invokes `refreshToken` for session S (created for tenant A, actor X) with a validly-signed token whose `tenant_id` is tenant B (a different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and the session's `tenant_id` and in-memory `claims.tenant_id` remain bound to tenant A (or the session is closed and no subsequent scope checks run under tenant B's identity)

### Requirement: refreshToken MUST reject tokens whose actor does not match the session

The system SHALL verify that `claims.sub` in the new Bearer token equals `session.actorIdentity` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch.

#### Scenario: Actor drift rejected on refresh

- **WHEN** a caller invokes `refreshToken` for session S (created for actor X in tenant A) with a validly-signed token whose `sub` is actor Y (a different actor, same or different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and no scope check or publish-guard for session S evaluates actor Y's claims

### Requirement: refreshToken MUST NOT mutate session identity anchors

The system SHALL ensure that after a successful `refreshToken` call the DB columns `tenant_id` and `actor_identity` for the session row remain equal to their values at session creation time, and `session.tenantId` and `session.actorIdentity` in memory remain unchanged.

#### Scenario: Successful refresh preserves session identity anchors

- **WHEN** a caller invokes `refreshToken` for session S with a validly-signed token that matches `session.tenantId` and `session.actorIdentity`
- **THEN** the session DB row `tenant_id` and `actor_identity` columns are unchanged, `session.tenantId` and `session.actorIdentity` in memory are unchanged, and the session status becomes `ACTIVE`

