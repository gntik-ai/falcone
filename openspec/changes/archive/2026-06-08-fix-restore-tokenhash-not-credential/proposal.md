## Why

`ConfirmationsRepository.findByTokenHash` (lines 111-118) accepts either a raw random token or a 64-hex-character string. When the input matches `/^[a-f0-9]{64}$/i`, the function treats it as the already-computed `token_hash` and queries the database directly — skipping the SHA-256 step. The stored hash therefore doubles as a valid confirmation credential, not only an internal lookup key.

The `abort` helper in `confirmations.service.ts` (line 581) exploits this same path intentionally: it fetches the request by ID, then calls `confirm({ confirmationToken: request.tokenHash, confirmed: false }, actor)` — passing the stored `token_hash` as if it were the bearer token. This means the hash value, which exists in the database, any database replica, backup snapshot, or future audit export, is a sufficient secret to confirm or abort a restore without the original random token.

Combined with bug-004 (no tenant gate in `ConfirmationsService.confirm`), an attacker who reads the `token_hash` column — whether via a DB backup, a misconfigured read replica, or a future log-exposure path — can confirm or abort any pending restore cross-tenant.

## What Changes

- Remove the hex-passthrough branch from `ConfirmationsRepository.findByTokenHash`: always compute `hashToken(tokenOrHash)` regardless of the format of the input.
- Refactor the `abort` helper to look up the confirmation request by its primary key (`findById`) and call a dedicated internal abort path (`ConfirmationsService.abortById`) that takes a `requestId`, never re-using the stored `token_hash` as a credential.
- Add a new `ConfirmationsService.abortById(requestId, actor)` method (or equivalent) that performs the abort decision without routing through the `findByTokenHash` lookup.
- Ensure no internal caller passes `request.tokenHash` into any function that accepts a bearer token.

## Capabilities

### New Capabilities

- `backup-restore`: The confirmation token model is hardened so that the stored SHA-256 token hash is never accepted as a valid bearer credential; only the original random token produces a successful lookup.

### Modified Capabilities

## Impact

- `services/backup-status/src/confirmations/confirmations.repository.ts::ConfirmationsRepository.findByTokenHash` (lines 111-118) — hex-passthrough branch
- `services/backup-status/src/confirmations/confirmations.service.ts::abort` (line 578-582) — passes `request.tokenHash` as the `confirmationToken`
