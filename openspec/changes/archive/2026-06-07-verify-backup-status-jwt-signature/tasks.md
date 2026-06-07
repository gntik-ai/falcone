## 1. Dependencies

- [x] 1.1 Add `jose` and `jwks-rsa` to `services/backup-status/package.json`

## 2. JWT verification implementation

- [x] 2.1 In `services/backup-status/src/api/backup-status.auth.ts::validateToken` (lines 37–62), replace the manual base64-decode-only path with a JWKS-based `jwtVerify` call using `jose`, mirroring `services/realtime-gateway/src/auth/token-validator.mjs::createTokenValidator:115-123`
- [x] 2.2 Fetch signing keys from `KEYCLOAK_JWKS_URL` via `jwks-rsa` (or equivalent JWKS client)
- [x] 2.3 Verify `iss` against `KEYCLOAK_ISSUER` and `aud` against `KEYCLOAK_AUDIENCE` as part of `jwtVerify` options
- [x] 2.4 Remove the standalone post-hoc `exp` check; rely on `jwtVerify` for `exp` and `nbf` validation

## 3. TEST_MODE hardening

- [x] 3.1 Add a production guard in `validateToken`: if `NODE_ENV === 'production'` and `TEST_MODE === 'true'`, throw a startup/request-level error before any token processing

## 4. Verification

- [x] 4.1 Add black-box test `bbx-bkp-jwt-forge-01`: craft a JWT with `tenant_id` of a victim tenant, sign with an arbitrary key, confirm HTTP 401 on each of the 9 handler endpoints
- [x] 4.2 Add black-box test: valid Keycloak-signed token returns expected 200/data for the owning tenant
- [x] 4.3 Run `bash tests/blackbox/run.sh` and confirm green
