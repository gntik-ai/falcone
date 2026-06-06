## Why

`services/backup-status/src/api/backup-status.auth.ts::validateToken` (lines 37–62) configures `KEYCLOAK_JWKS_URL` as a required environment variable but never fetches or uses it. The production code path splits the token on `.`, base64-decodes the payload segment, checks `exp`, and returns `tenantId` and `scopes` directly from the decoded, unverified payload. The signature segment (`parts[2]`) is completely ignored.

This function is the sole authentication chokepoint imported by every handler in the service. The tenant guard at `services/backup-status/src/api/backup-status.action.ts:93` trusts `claims.tenantId` and `claims.scopes` exclusively from this unverified payload, meaning any caller can forge a JWT payload with an arbitrary `tenant_id` and gain full cross-tenant access to backup status, backup triggering, and restore operations. This is source finding `iso-001` / `bug-002`.

The correct pattern is already present in the codebase: `services/realtime-gateway/src/auth/token-validator.mjs::createTokenValidator` (lines 95–190) performs full JWKS-based verification using `jose` and `jwks-rsa`.

## What Changes

- `services/backup-status/src/api/backup-status.auth.ts::validateToken` — replace the manual base64-decode-only path with full JWKS-based `jwtVerify` (via `jose`) and key resolution (via `jwks-rsa`), mirroring `services/realtime-gateway/src/auth/token-validator.mjs:115-123`.
- Verify issuer and audience via `KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` env vars alongside `KEYCLOAK_JWKS_URL`.
- Verify `exp` and `nbf` as part of cryptographic verification, not as a post-hoc manual check.
- Harden `TEST_MODE`: assert `TEST_MODE !== 'true'` when `NODE_ENV === 'production'`.
- Add `jose` and `jwks-rsa` dependencies to `services/backup-status/package.json`.
- No per-handler changes required; all 9 handlers benefit automatically.

## Capabilities

### New Capabilities

- `backup-restore`: Cryptographic JWT signature verification and tenant-identity binding for all backup-restore service handlers, ensuring that `tenantId` and `scopes` extracted from a token have been validated against the Keycloak JWKS endpoint before any tenant-scoped operation is performed.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the backup-restore capability spec -->

## Impact

- `services/backup-status/src/api/backup-status.auth.ts::validateToken:37-62` — primary implementation target; no JWKS fetch, signature ignored.
- `services/backup-status/src/api/backup-status.action.ts:86-103` — tenant guard trusting unverified claims; gains correctness once `validateToken` is fixed.
- All 9 handlers (`backup-status.action.ts`, `list-snapshots.action.ts`, `trigger-backup.action.ts`, `trigger-restore.action.ts`, `get-operation.action.ts`, `query-audit.action.ts`, `second-actor-verifier.ts`, `initiate-restore.action.ts`, `confirm-restore.action.ts`) gain cryptographic verification with no interface changes.
- Forged tokens receive HTTP 401; valid Keycloak-signed tokens continue to pass.
- Reference implementation: `services/realtime-gateway/src/auth/token-validator.mjs::createTokenValidator:95-190`.
