# backup-restore Specification

## Purpose
TBD - created by archiving change fix-restore-tokenhash-not-credential. Update Purpose after archive.
## Requirements
### Requirement: Confirmation lookup MUST always hash the supplied token and MUST NOT accept a raw hash as a credential

The system SHALL compute a SHA-256 hash of any caller-supplied token string before performing the database lookup; the system SHALL NOT treat a 64-hex-character input as a pre-computed hash that bypasses the hash step.

#### Scenario: Supplying the stored token_hash directly is rejected as a credential (bbx-tokenhash-credential)

- **WHEN** a caller submits a confirm-restore request with `confirmation_token` set to the exact 64-hex-character SHA-256 hash of the original token (i.e. the value stored in the `token_hash` column), and the original random token is not supplied
- **THEN** the system returns HTTP 404 (confirmation request not found) and does not confirm, abort, or mutate the confirmation request in any way

#### Scenario: A valid random token still resolves and confirms the request

- **WHEN** a caller submits a confirm-restore request with `confirmation_token` set to the original random token that was issued at initiate time, and all other confirmation conditions are satisfied (same tenant, valid expiry, `confirmed: true`)
- **THEN** the system returns HTTP 202 and the restore is accepted normally

### Requirement: Internal abort MUST NOT pass the stored token_hash as a confirmation credential

The system SHALL provide an internal abort mechanism (`abortById` or equivalent) that accepts a confirmation request ID directly and does not route the stored `token_hash` through the public `findByTokenHash` lookup path.

#### Scenario: Internal abort by request ID succeeds without using the token_hash as a bearer token

- **WHEN** the system internally aborts a pending confirmation request using the request ID (not the token)
- **THEN** the abort is recorded in the database and the `token_hash` value is never compared against the caller-supplied bearer token string

#### Scenario: No code path passes request.tokenHash into a function expecting a bearer token

- **WHEN** the codebase is reviewed for all call sites of `findByTokenHash` and `confirm`
- **THEN** no call site passes a value sourced from `request.tokenHash` or `row.token_hash` into the `confirmationToken` parameter of `confirm` or the `tokenOrHash` parameter of `findByTokenHash`

