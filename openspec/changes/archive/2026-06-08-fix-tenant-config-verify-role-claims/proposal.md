## Why

The tenant-config action family (`tenant-config-migrate`, `tenant-config-validate`, `tenant-config-export`, `tenant-config-preflight`, `tenant-config-reprovision`, and siblings) derives actor role and privilege by base64url-decoding the raw Bearer token payload with no signature verification, no issuer check, no audience check, and no expiry check. The `extractAuth` helper in each file reads `realm_access.roles` and `scope` from the unverified payload and grants `actor_type = 'superadmin' | 'sre' | 'service_account'`. An attacker who can reach these OpenWhisk actions with a self-crafted unsigned JWT carrying `{"realm_access":{"roles":["superadmin"]},"scope":"platform:admin:config:export"}` is granted platform-admin privilege — enabling config export, migration, and reprovisioning of arbitrary tenants without holding a real Keycloak-issued token. This is strictly worse than the parallel CDC bug (bug-001) because the forged claim grants a *role/privilege* rather than just a data-scope.

## What Changes

- Replace the `extractAuth` pattern (raw base64url decode of JWT payload) in every `tenant-config-*.mjs` action with either: (a) identity sourced exclusively from gateway-injected trusted headers (`x-tenant-id`, `x-actor-type`, `x-actor-id`, `x-actor-scopes`) if those headers are authoritative in the deployment topology, or (b) full JWKS-signature verification (iss/aud/exp) before reading `realm_access.roles` / `scope`, mirroring `services/realtime-gateway/src/auth/token-validator.mjs`.
- Remove the `extractAuth` helper from all affected `tenant-config-*.mjs` files.
- Any request whose token fails verification (or whose gateway headers are absent) is rejected with `401 UNAUTHORIZED`.
- A request carrying a structurally-valid but unsigned token MUST be rejected with `403 FORBIDDEN` — `actor_type` must not be derived from an unverified payload.
- **No API surface change**; no new fields added or removed; behaviour is identical for legitimate callers whose tokens are properly signed.

## Capabilities

### New Capabilities

- `tenant-provisioning`: Tenant-config actions derive actor role and privilege exclusively from verified token claims or trusted gateway headers; unverified or self-crafted JWT payloads can no longer forge platform-admin privilege.

### Modified Capabilities

## Impact

- `services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs::extractAuth` (lines 23-41)
- `services/provisioning-orchestrator/src/actions/tenant-config-validate.mjs::extractAuth` (lines 23-41)
- `services/provisioning-orchestrator/src/actions/tenant-config-export.mjs::extractAuth`
- `services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs::extractAuth`
- `services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs::extractAuth`
- `services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs::extractAuth`
- `services/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs::extractAuth`
- Reference verification pattern: `services/realtime-gateway/src/auth/token-validator.mjs`
- Reference trusted-header pattern: `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`
