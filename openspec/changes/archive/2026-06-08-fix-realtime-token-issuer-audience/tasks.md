## 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-realtime-aud-binding` to `tests/blackbox/` that presents a validly-signed RS256 token whose `iss` does not match `KEYCLOAK_ISSUER` and asserts the validator returns `TOKEN_INVALID`
- [ ] 1.2 Add a companion assertion in `bbx-realtime-aud-binding` that presents a validly-signed token whose `aud` does not include `KEYCLOAK_AUDIENCE` and asserts the validator returns `TOKEN_INVALID`
- [ ] 1.3 Add an assertion that a validly-signed token with correct `iss` and `aud` is accepted (positive case)
- [ ] 1.4 Confirm all new assertions fail (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [ ] 2.1 In `services/realtime-gateway/src/config/env.mjs`, add `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` to `REQUIRED_STRING_KEYS` and return both from `loadEnv` as validated non-empty strings
- [ ] 2.2 In `services/realtime-gateway/src/auth/token-validator.mjs::verifyLocally`, replace `{ clockTolerance: '5 seconds' }` with `{ issuer: env.KEYCLOAK_ISSUER, audience: env.KEYCLOAK_AUDIENCE, clockTolerance: '5 seconds' }`

## 3. Verify

- [ ] 3.1 Confirm `bbx-realtime-aud-binding` tests now pass (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green
