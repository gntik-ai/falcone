## 1. Add Failing Black-Box Test

- [x] 1.1 Add test `bbx-refresh-tenant-drift` to `tests/blackbox/` that creates a session for tenant A (actor X), then calls `refreshToken` with a validly-signed token for tenant B, and asserts the call returns an `IDENTITY_MISMATCH` error and does not leave the session in a state where subsequent scope checks evaluate tenant B's claims
- [x] 1.2 Add a companion assertion in `bbx-refresh-tenant-drift` verifying that a `refreshToken` call with a different `sub` (actor drift) is also rejected with `IDENTITY_MISMATCH`
- [x] 1.3 Confirm both assertions fail (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [x] 2.1 In `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken`, after `const claims = await validateTokenFn(newBearerToken)`, add an identity-stability guard: if `claims.tenant_id !== session.tenantId || claims.sub !== session.actorIdentity`, call `closeSession(sessionId, db)` and throw an error with `code: 'IDENTITY_MISMATCH'` before mutating any session state
- [x] 2.2 Ensure the `IDENTITY_MISMATCH` error message does not include the session's `tenantId` or `actorIdentity` values

## 3. Verify

- [x] 3.1 Confirm `bbx-refresh-tenant-drift` tests now pass (green)
- [x] 3.2 Run `bash tests/blackbox/run.sh` and confirm green
