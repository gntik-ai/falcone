## 1. Add Failing Black-Box Test

- [x] 1.1 Added tests T5a and T5b to `services/backup-status/test/unit/api/backup-status.auth.test.ts` (vitest, not node --test blackbox): with `TEST_MODE=true`, `NODE_ENV=staging`, and `KEYCLOAK_JWKS_URL` set, forged tokens with `superadmin` and `backup:restore:global` scopes must be rejected — confirmed RED before fix
- [x] 1.2 T5b covers the `backup:restore:global` scope rejection companion scenario
- [x] 1.3 T5c covers the positive isolated-env case: `TEST_MODE=true`, `KEYCLOAK_JWKS_URL` absent → unsigned-payload path accepted
- [x] 1.4 Confirmed T5a and T5b failed (red) against unpatched code; T5c and T1/T2/T3/T4 were green

## 2. Implement the Fix

- [x] 2.1 Added call-time guard in `services/backup-status/src/api/backup-status.auth.ts::validateToken`: if `testMode && jwksConfigured` → throw `AuthError(500, 'TEST_MODE is not permitted when a JWKS URL is configured')`. Applied identically to `.js` sibling.
- [x] 2.2 Guard uses `process.env` at call time (not module-load constants) so runtime env changes in tests are respected

## 3. Verify

- [x] 3.1 All 7 auth tests (T1–T5c) pass green; T4 via `_setJwksOverride` unaffected
- [x] 3.2 `bash tests/blackbox/run.sh` → 145/145 pass, no regressions; `npm run typecheck` → clean
