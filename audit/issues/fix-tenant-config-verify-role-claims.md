# Tenant-config actions grant platform-admin from unverified realm_access.roles (privilege forgery)

| Field | Value |
|-------|-------|
| Change ID | `fix-tenant-config-verify-role-claims` |
| Capability | `tenant-provisioning` |
| Type | bug |
| Priority | P0 |
| OpenSpec change | `openspec/changes/fix-tenant-config-verify-role-claims/` |

## Why

The `tenant-config-*` OpenWhisk action family (migrate, validate, export, preflight, reprovision, export-domains, identifier-map) grants `actor_type = 'superadmin' | 'sre' | 'service_account'` based on `realm_access.roles` and `scope` claims read from a **base64url-decoded JWT payload with no signature, issuer, audience, or expiry verification**. The `extractAuth` helper in each file does:

```
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
const roles = payload.realm_access?.roles ?? [];
if (roles.includes('superadmin')) actor_type = 'superadmin';
```

An attacker who can reach these actions with a self-crafted unsigned Bearer token carrying `{"realm_access":{"roles":["superadmin"]},"scope":"platform:admin:config:export"}` is granted full platform-admin privilege — enabling config export, migration, and reprovisioning of arbitrary tenants. This is strictly worse than the parallel CDC bug (bug-001) because the forged claim grants a *role* rather than just a data scope.

## What Changes

- Replace `extractAuth` (raw base64url decode) in all seven `tenant-config-*.mjs` files with identity sourced from gateway-injected trusted headers or full JWKS-verified token claims (iss/aud/exp checked).
- Remove the `extractAuth` helper from all affected files.
- Requests carrying an unsigned or structurally-invalid token are rejected with `403 FORBIDDEN` before the action body is processed.
- No API surface change; legitimate callers are not broken.

## Spec delta (EARS)

From `openspec/changes/fix-tenant-config-verify-role-claims/specs/tenant-provisioning/spec.md`:

**The system SHALL** reject any request to a `tenant-config-*` action whose Bearer token cannot be cryptographically verified (signature, issuer, audience, and expiry) before any role or scope claim is evaluated.

**The system SHALL NOT** evaluate `realm_access.roles`, `scope`, `azp`, or any other claim from a JWT payload before the token's cryptographic signature has been verified.

Key scenarios:
- WHEN a caller presents a forged unsigned token with `realm_access.roles:["superadmin"]` THEN the action MUST return 403 and MUST NOT grant `actor_type = 'superadmin'`
- WHEN a valid JWKS-signed token with correct role is presented THEN the action proceeds normally
- WHEN no Authorization header is present THEN the action returns 403

## Tasks

See `openspec/changes/fix-tenant-config-verify-role-claims/tasks.md` for the full checklist. Summary:

1. Write failing `bbx-config-forged-superadmin` black-box test (red first)
2. Audit gateway config for trusted role/scope headers
3. Replace `extractAuth` in all seven files (trusted headers or JWKS verification)
4. Run `bash tests/blackbox/run.sh` — confirm green
5. Archive the change

## Acceptance criteria

- `bbx-config-forged-superadmin`: invoking `tenant-config-migrate` with an unsigned token claiming `realm_access.roles:["superadmin"]` returns `403`; action body is never processed.
- `bbx-config-forged-superadmin` (sre variant): unsigned token claiming `realm_access.roles:["sre"]` on `tenant-config-validate` returns `403`.
- `bbx-config-forged-superadmin` (service_account variant): unsigned token claiming `scope:"platform:admin:config:export"` on `tenant-config-export` returns `403`.
- All existing `tenant-config-*` contract tests continue to pass.

## Code evidence

- `services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs::extractAuth` (lines 23-41) — raw base64url decode, grants `superadmin`/`sre`/`service_account` from unverified payload
- `services/provisioning-orchestrator/src/actions/tenant-config-validate.mjs::extractAuth` (lines 23-41) — identical pattern
- Same pattern confirmed in `tenant-config-export.mjs`, `tenant-config-preflight.mjs`, `tenant-config-reprovision.mjs`, `tenant-config-export-domains.mjs`, `tenant-config-identifier-map.mjs`
- Reference safe pattern: `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` (trusted gateway headers)
- Reference JWKS pattern: `services/realtime-gateway/src/auth/token-validator.mjs`

## Resolution (OpenSpec)

```
/fix-bug fix-tenant-config-verify-role-claims
```

Which expands to:
1. `/opsx:apply fix-tenant-config-verify-role-claims` — implement changes per `tasks.md` (failing test first)
2. `/opsx:verify fix-tenant-config-verify-role-claims`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive fix-tenant-config-verify-role-claims`

Optional real-stack reproduction: `/e2e-issue fix-tenant-config-verify-role-claims`
