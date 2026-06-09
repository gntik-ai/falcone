## Context

`ConfirmationsRepository.findByTokenHash` (confirmations.repository.ts:111-118) is designed to accept either form:

```
const tokenHash = /^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)
```

The intent was convenience — callers that already hold the hash can skip re-hashing. However, the stored `token_hash` is a SHA-256 digest. SHA-256 output is always 64 hex characters. So the branch makes the hash itself a valid input credential, indistinguishable from any other 64-hex string a caller might supply.

The `abort` helper (confirmations.service.ts:578-582) relies on this property:

```typescript
const request = await new ConfirmationsRepositoryClass().findById(confirmationRequestId)
if (!request) throw new ConfirmationError(404, 'confirmation_request_not_found')
return await defaultService.confirm({ confirmationToken: request.tokenHash, confirmed: false }, actor)
```

It loads the request by primary key, then re-uses `request.tokenHash` as the `confirmationToken` to drive the shared `confirm()` code path. This avoids duplicating the abort state-machine logic, but it creates the vulnerability.

## Goals / Non-Goals

**Goals:**
- Ensure `findByTokenHash` always hashes the input — remove the hex-passthrough shortcut.
- Eliminate the `abort` code path that passes `request.tokenHash` as a `confirmationToken`.
- Introduce a clean internal `abortById(requestId, actor)` method that reuses the abort state machine without going through the token lookup.

**Non-Goals:**
- Changing the token generation mechanism or the SHA-256 hash column (schema unchanged).
- Altering the `confirm` method signature or the confirm-restore action layer.
- Addressing the missing tenant gate in `confirm` (that is covered by `fix-confirm-restore-tenant-gate`).

## Decisions

**Decision: Remove the hex-passthrough in `findByTokenHash` unconditionally.**
Rationale: There is no legitimate caller that needs to pass a pre-hashed value through the public token-lookup path. The only caller that did so (`abort`) is refactored away. Removing the branch simplifies the lookup contract: it always accepts a raw token, never a hash.

**Decision: Introduce `ConfirmationsService.abortById(requestId, actor)` rather than duplicating state-machine logic.**
Rationale: The abort state machine (mark decision='aborted', emit audit event) should not be duplicated. `abortById` fetches the request by ID and calls the shared abort state-machine logic directly, bypassing the token-lookup step. This is the correct internal abstraction.

**Decision: Keep `confirm` unchanged in its public contract.**
Rationale: External callers supply a raw token via `confirmationToken`. The internal change to `findByTokenHash` is transparent to them.

## Risks / Trade-offs

**Risk:** Any integration test or internal caller that was relying on passing `token_hash` directly will break.
**Mitigation:** Auditing all call sites of `findByTokenHash` shows the only such caller is the `abort` helper, which is refactored as part of this change.

**Risk:** The refactored `abortById` adds a small amount of parallel code to the state machine.
**Mitigation:** The state machine is small and well-tested; the new method shares the same audit-emit logic.

## Migration Plan

No database schema changes are required. Changes are localized to:

1. `services/backup-status/src/confirmations/confirmations.repository.ts::ConfirmationsRepository.findByTokenHash`: replace the conditional hash branch with an unconditional `hashToken(tokenOrHash)` call.
2. `services/backup-status/src/confirmations/confirmations.service.ts::abort`: replace the `confirm({ confirmationToken: request.tokenHash, ... })` call with a new `abortById(requestId, actor)` method that fetches by ID and calls the abort state machine directly.
3. Add `ConfirmationsService.abortById` (or equivalent module-level export `abortById`) implementing the abort path without a token lookup.
4. Update unit tests; add `bbx-tokenhash-credential` black-box probe.
