# Restore confirmation treats stored token-hash as a bearer credential

| Field | Value |
|---|---|
| Change ID | `fix-restore-tokenhash-not-credential` |
| Capability | `backup-restore` |
| Type | bug |
| Priority | P2 |
| OpenSpec change | `openspec/changes/fix-restore-tokenhash-not-credential/` |

## Why

`ConfirmationsRepository.findByTokenHash` (confirmations.repository.ts:111-118) contains a format-sniff branch: when the caller-supplied string matches `/^[a-f0-9]{64}$/i`, it is treated as the already-computed `token_hash` and passed directly to the SQL query, skipping the SHA-256 step. Because SHA-256 output is always 64 hex characters, the stored hash is indistinguishable from this branch and becomes a valid confirmation credential.

The `abort` helper (confirmations.service.ts:578-582) intentionally exploits this: it loads the confirmation request by primary key via `findById`, then calls `confirm({ confirmationToken: request.tokenHash, confirmed: false }, actor)` — passing the stored hash as a bearer token to drive the shared `confirm()` code path. This means the `token_hash` column value, which exists in every DB backup, read replica, and future audit export, is sufficient to confirm or abort any pending restore without the original random token.

Combined with the missing tenant gate in `ConfirmationsService.confirm` (bug-004 / `fix-confirm-restore-tenant-gate`), an attacker who reads the `token_hash` column can perform a cross-tenant destructive restore confirmation.

## What Changes

- Remove the hex-passthrough branch from `ConfirmationsRepository.findByTokenHash`: always compute `hashToken(tokenOrHash)` unconditionally.
- Refactor the `abort` helper to use a new `ConfirmationsService.abortById(requestId, actor)` path that never passes `request.tokenHash` as a credential.
- Audit and confirm no other call site passes a stored hash into `findByTokenHash` or `confirm`.

## Spec delta (EARS)

From `openspec/changes/fix-restore-tokenhash-not-credential/specs/backup-restore/spec.md`:

**Requirement: Confirmation lookup MUST always hash the supplied token and MUST NOT accept a raw hash as a credential**

The system SHALL compute a SHA-256 hash of any caller-supplied token string before performing the database lookup; the system SHALL NOT treat a 64-hex-character input as a pre-computed hash that bypasses the hash step.

**Scenario: Supplying the stored token_hash directly is rejected as a credential**

- WHEN a caller submits a confirm-restore request with `confirmation_token` set to the exact 64-hex SHA-256 hash stored in `token_hash`
- THEN the system returns HTTP 404 and does not confirm, abort, or mutate the confirmation request

**Requirement: Internal abort MUST NOT pass the stored token_hash as a confirmation credential**

The system SHALL provide an internal abort mechanism (`abortById` or equivalent) that accepts a request ID and does not route the stored `token_hash` through the public `findByTokenHash` lookup.

## Tasks

From `openspec/changes/fix-restore-tokenhash-not-credential/tasks.md`:

- [ ] 1.1 Add test `bbx-tokenhash-credential` — confirm-restore with `confirmation_token=<token_hash>` must return HTTP 404
- [ ] 1.2 Add positive test — confirm-restore with original raw token returns HTTP 202
- [ ] 1.3 Run `bash tests/blackbox/run.sh` and confirm test FAILS before fix
- [ ] 2.1 Replace hex-passthrough branch in `findByTokenHash` with unconditional `hashToken(tokenOrHash)`
- [ ] 2.2 Verify no other caller passes a pre-hashed value
- [ ] 3.1 Add `ConfirmationsService.abortById(requestId, actor)` that uses `findById` + abort state machine directly
- [ ] 3.2 Replace `abort` helper body with a call to `abortById`
- [ ] 3.3 Audit all remaining call sites of `findByTokenHash`
- [ ] 4.1 Run `bash tests/blackbox/run.sh` — `bbx-tokenhash-credential` green

## Acceptance criteria

- `bbx-tokenhash-credential`: presenting the stored `token_hash` as `confirmation_token` returns HTTP 404 with no state change
- No code path exists where a value sourced from `request.tokenHash` or a DB `token_hash` column is passed into the `confirmationToken` parameter of `confirm` or the `tokenOrHash` parameter of `findByTokenHash`
- The original raw-token confirm flow continues to return HTTP 202

## Code evidence

- `services/backup-status/src/confirmations/confirmations.repository.ts::ConfirmationsRepository.findByTokenHash` (line 112) — hex-passthrough: `const tokenHash = /^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)`
- `services/backup-status/src/confirmations/confirmations.service.ts::abort` (lines 578-582) — `return await defaultService.confirm({ confirmationToken: request.tokenHash, confirmed: false }, actor)`
- `services/backup-status/src/api/confirm-restore.action.ts::main` (lines 82-95) — calls `confirm()` with `confirmationToken: body.confirmation_token` (correct for external callers; the internal `abort` path is the vulnerable one)

## Resolution (OpenSpec)

```
/opsx:apply fix-restore-tokenhash-not-credential
/opsx:verify fix-restore-tokenhash-not-credential
bash tests/blackbox/run.sh
/opsx:archive fix-restore-tokenhash-not-credential
```

Or use the wrapper: `/fix-bug fix-restore-tokenhash-not-credential`

Optional real-stack E2E: `/e2e-issue fix-restore-tokenhash-not-credential`
