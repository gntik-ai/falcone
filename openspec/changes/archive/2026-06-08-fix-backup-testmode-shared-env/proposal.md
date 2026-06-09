## Why

`validateToken` in `services/backup-status/src/api/backup-status.auth.ts` (lines 82-102) contains a `TEST_MODE` path that parses `token.split('.')[1]` as a base64url-encoded JSON payload with **no signature verification** and returns the self-asserted `sub`, `tenantId`, and `scopes` claims verbatim. The only guard against this bypass is `NODE_ENV === 'production'`: the combination `IS_PRODUCTION && IS_TEST_MODE` throws a 500 at module load time (lines 77-79), and an equivalent re-check at call time (lines 83-86). Any deployment where `TEST_MODE=true` and `NODE_ENV` is anything other than `"production"` — including `staging`, `ci`, `test`, `development`, or an unset/empty value — executes the unsigned-payload path. A non-production cluster shared with real or simulated tenants (common for staging/CI environments) accepts fully-forged tokens carrying arbitrary `scopes` such as `backup:restore:global` or `superadmin`, bypassing all authentication and directly compounding the cross-tenant risk of bug-003 and bug-004.

## What Changes

- Add a mandatory allow-list of environments in which `TEST_MODE` is permitted (e.g., only `test` or environments with no real JWKS URL configured).
- Block `TEST_MODE` whenever `KEYCLOAK_JWKS_URL` is set to a non-empty value, regardless of `NODE_ENV`; a real IdP URL is a strong signal that the deployment is not an isolated unit-test environment.
- Alternatively (and additionally): narrow the unsigned-payload path to the `_setJwksOverride`-based path so that test-mode tokens require a locally-provided key set, eliminating the no-signature path entirely.
- The fix MUST NOT break the existing `_setJwksOverride` injection mechanism used in unit tests.

## Capabilities

### New Capabilities

- `backup-restore`: `TEST_MODE` authentication bypass is blocked in any deployment that has a real JWKS URL configured, preventing forged-token auth bypass on staging and CI clusters accessible to tenants.

### Modified Capabilities

## Impact

- `services/backup-status/src/api/backup-status.auth.ts::validateToken` (lines 82-102) — tighten the TEST_MODE guard
- `services/backup-status/src/api/backup-status.auth.ts::getJwks` (lines 44-64) — guard logic reads KEYCLOAK_JWKS_URL; no structural change needed
