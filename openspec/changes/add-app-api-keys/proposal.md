## Why

There is no shippable credential for browser or server clients today. Every data
route in `services/gateway-config/base/public-api-routing.yaml` (lines 232–461) uses
`authMode: bearer_oidc`, which requires a Keycloak session — unusable from a
frontend app or a server integration without a full OIDC flow. The APISIX
`key-auth` plugin is declared in
`services/gateway-config/plugins/credential-rotation-header.yaml` but is not wired
to any route. The Keycloak adapter functions that would issue service-account
credentials (`createServiceAccount`, `updateServiceAccountScopeBindings`,
`regenerateServiceAccountCredentials` at
`services/adapters/src/keycloak-admin.mjs:553-583`) all throw `NOT_YET_IMPLEMENTED`.
Scope enforcement is disabled cluster-wide (`SCOPE_ENFORCEMENT_ENABLED:-false` at
`services/gateway-config/base/public-api-routing.yaml:496`). Per-key rate limiting
is absent; all `qosProfiles` key only on `X-Tenant-Id`.

## What Changes

- Mint per-workspace ANON (publishable) and SERVICE (secret) API keys: hashed at rest
  in a new `workspace_api_keys` table; plain-text secret returned once and never
  stored or logged.
- Wire the APISIX `key-auth` plugin on all `data` and `event` routes so an inbound
  key resolves to `tenant_id`, `workspace_id`, a DB role, and a scope set; the gateway
  then injects the same `X-Tenant-Id`/`X-Workspace-Id`/`X-Auth-Scopes`/`X-Actor-Roles`
  headers the JWT path already propagates.
- ANON key maps to a restricted, RLS-governed DB role (safe in a browser); SERVICE
  key maps to an elevated role with broader access.
- Enable `SCOPE_ENFORCEMENT_ENABLED` for data routes; a request missing a required
  scope returns 403.
- Add per-key `limit-count` rate limiting in APISIX; budget exceeded returns 429.
- Implement rotate (issues new secret, invalidates old) and revoke operations.
- Replace the `NOT_YET_IMPLEMENTED` stubs in `keycloak-admin.mjs` OR implement a
  control-plane-native hashed-key store (choice stated in `design.md`).

## Capabilities

### New Capabilities

- `app-credentials`: Per-workspace ANON and SERVICE API key issuance, gateway
  key-auth resolution, scope enforcement, per-key rate limiting, rotation, and
  revocation.

### Modified Capabilities

- `gateway-and-public-surface`: data/event routes gain `key-auth` as a second valid
  `authMode`; `SCOPE_ENFORCEMENT_ENABLED` toggled on for those routes; per-key
  `limit-count` profile added to `qosProfiles`.

## Impact

- `apps/control-plane/openapi/families/workspaces.openapi.json` — credential-issuance,
  credential-rotations, and credential-revocations endpoints (lines 6775-7251) are
  already modeled; they need a concrete request/response shape for ANON/SERVICE keys.
- `apps/control-plane/src/workflows/wf-con-006-service-account.mjs` — `create`,
  `rotate`, `deactivate`, `delete` actions; depends on adapter stubs being replaced.
- `services/adapters/src/keycloak-admin.mjs:553-583` — replace `NOT_YET_IMPLEMENTED`
  stubs, OR bypass Keycloak entirely with a Postgres-native key store (see `design.md`).
- `services/gateway-config/base/public-api-routing.yaml` — add `key_auth` auth mode
  to data/event routes; enable `SCOPE_ENFORCEMENT_ENABLED`; add per-key `limit-count`
  `qosProfile`.
- New migration `services/provisioning-orchestrator/src/migrations/121-workspace-api-keys.sql`
  adding `workspace_api_keys` table (key_hash, key_type ANON|SERVICE, workspace_id,
  tenant_id, scopes, rate_limit_budget, revoked_at).
- Pairs with `add-console-rls-policies` (defines ANON-safe RLS policies) and
  `add-postgres-data-crud-execute` (enforces them at the data layer).
