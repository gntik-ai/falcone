## Why

The backup-status restore-API surface has three load-bearing auth
defects: production JWTs are not signature-verified, the `superadmin`
realm role is checked as a scope literal (the check is always false),
and the action layer trusts `body.tenant_id` as-is. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B1** (`services/backup-status/src/api/initiate-restore.action.ts:20, :62`
  and `confirm-restore.action.ts:21, :25`) — `token.scopes.includes('superadmin')`
  is dead: `superadmin` is a Keycloak realm role propagated via
  `$jwt_claim_realm_access_roles`, not a scope. Actors get tagged
  `role: 'sre'` (also phantom) as a side effect.
- **B2** (`initiate-restore.action.ts:20-75`) — the action extracts
  `body.tenant_id` and passes it to `confirmations.service.initiate()`
  without checking it against `token.tenantId`; a holder of
  `backup:restore:global` (misconfigured) can restore any tenant.
- **B3** (`api/backup-status.auth.ts:36-62`) — production path requires
  `KEYCLOAK_JWKS_URL` to be set but never fetches JWKS nor verifies the
  signature; the source comment says "simplified verification approach
  for the MVP". Any forged JWT with valid base64 payload + unexpired
  `exp` passes.
- **G1** (`G-cross.1`) — production JWT signature verification absent
  (same as B3, raised).
- **G2** (`G-cross.2`) — `TokenClaims` has no `roles` field (same as
  B1, raised).
- **G10** (`G-S1.3`) — no tenant-isolation check in the restore
  initiate/confirm actions (same as B2, raised).

## What Changes

- Implement JWKS-backed JWT signature verification in
  `backup-status.auth.ts`: fetch + cache JWKS from `KEYCLOAK_JWKS_URL`,
  verify `alg`/`kid`/signature, then check `exp`/`nbf`/`iss`/`aud`.
- Add a `roles: string[]` field to `TokenClaims`, populated from
  `realm_access.roles`; replace every `token.scopes.includes('superadmin')`
  check with `token.roles.includes('superadmin')`.
- Add a tenant-isolation guard in `initiate-restore.action.ts` and
  `confirm-restore.action.ts`: the request's `body.tenant_id` MUST
  equal `token.tenantId` UNLESS the actor carries the `superadmin`
  realm role.
- Remove the `role: 'sre'` actor tagging; the actor role MUST be
  computed from the verified realm-role set.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on JWT signature verification,
  realm-role propagation, and tenant-isolation enforcement at the
  restore-API edge.

## Impact

- **Affected code**:
  `services/backup-status/src/api/backup-status.auth.ts`,
  `services/backup-status/src/api/initiate-restore.action.ts`,
  `services/backup-status/src/api/confirm-restore.action.ts`,
  `services/backup-status/src/api/backup-status.action.ts`.
- **Migration required**: none (auth layer only).
- **Breaking changes**: tokens that today silently pass without
  signature verification will now be rejected; callers using
  `backup:restore:global` without `superadmin` will no longer be able
  to restore tenants other than their own.
- **Cross-cutting**: every downstream call site that reads
  `claims.scopes.includes('superadmin')` must move to
  `claims.roles.includes('superadmin')`.
