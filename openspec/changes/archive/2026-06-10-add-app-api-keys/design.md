## Context

The public API surface in `apps/control-plane/openapi/families/workspaces.openapi.json`
already models credential-issuance (line 6775), credential-rotations (line 7095), and
credential-revocations (line 6935) routes for workspace service accounts. The workflow
that would execute these operations (`apps/control-plane/src/workflows/wf-con-006-service-account.mjs`)
dispatches to `createServiceAccount`, `updateServiceAccountScopeBindings`, and
`regenerateServiceAccountCredentials` in
`services/adapters/src/keycloak-admin.mjs:553-583`, all of which throw
`NOT_YET_IMPLEMENTED`. The APISIX key-auth plugin is declared in
`services/gateway-config/plugins/credential-rotation-header.yaml` but is not wired
to any route; every data and event route uses `authMode: bearer_oidc` only. Scope
enforcement is globally disabled via `SCOPE_ENFORCEMENT_ENABLED:-false`
(`services/gateway-config/base/public-api-routing.yaml:496`). All `qosProfiles`
key rate limits on `X-Tenant-Id`; no per-key budget exists.

## Goals / Non-Goals

**Goals:**
- Implement ANON and SERVICE key minting, hashed storage, one-time secret reveal.
- Wire APISIX key-auth on data and event routes; inject the same identity headers
  the JWT path already propagates.
- Enable `SCOPE_ENFORCEMENT_ENABLED` for data and event routes.
- Add per-key `limit-count` rate limiting.
- Implement rotate (atomic old-revoke + new-issue) and revoke.
- Confirm ANON key maps to an RLS-restricted DB role.

**Non-Goals:**
- Realtime/WebSocket key-auth (deferred; realtime routes are out of scope for this
  change).
- Key expiry scheduling / automatic rotation reminders (covered by the existing
  `tenant_rotation_policies` table from migration `089-api-key-rotation.sql`; wiring
  it to ANON/SERVICE keys is a follow-on).
- Multi-key grace-period overlap during rotation (immediate invalidation only in
  this change).

## Decisions

**D1 — Postgres-native hashed key store, not Keycloak service accounts.**
Rationale: The Keycloak service-account adapter functions are stubs with no
implementation path verified in code. Implementing a Postgres-native `workspace_api_keys`
table (key_hash TEXT, key_type ANON|SERVICE, tenant_id, workspace_id, scopes JSONB,
rate_limit_budget INTEGER, revoked_at TIMESTAMPTZ) keeps the hot-path lookup inside
the existing Postgres infrastructure, avoids a synchronous Keycloak call on every
request, and makes the key record directly queryable for audits and RLS proofs.
Trade-off: the APISIX key-auth consumer store must be populated from Postgres on
mint/rotate/revoke via a cache-warm step or a direct DB lookup plugin; this adds a
cache-invalidation concern that Keycloak's built-in consumer management would avoid.
Mitigation: APISIX `limit-count` uses the key hash as the consumer key; lookup is
done via a Lua serverless function that queries the Postgres key store on cache miss
(TTL configurable via `APP_KEY_CACHE_TTL_SECONDS`).

**D2 — SHA-256 (hex) hash at rest; plain-text returned exactly once.**
Rationale: SHA-256 is already used for token hashes in
`apps/control-plane/src/observability-audit-export.mjs:146`. Fast to verify, no
per-key salt needed at this tier (keys are high-entropy random values). Plain-text
never written to any persistent store, log, or audit event payload.

**D3 — ANON key maps to the `anon` DB role; SERVICE key maps to `service_role`.**
Rationale: Mirrors the Supabase naming convention already chosen as the locked
decision. The `anon` role is subject to RLS; `service_role` bypasses RLS. Requires
that `add-console-rls-policies` is applied first in production so that ANON-accessible
tables have policies in place before ANON keys are issued.

**D4 — Scope enforcement enabled at the route level, not globally.**
Rationale: Flipping `SCOPE_ENFORCEMENT_ENABLED` globally would affect bearer-OIDC
paths that have not yet been audited for scope completeness. Enabling it per data/event
route via a route-level override is safer and backward-compatible.

**D5 — Rotation is immediate (no grace-period overlap in this change).**
Rationale: Grace-period rotation infra exists (`service_account_rotation_states` in
migration `089-api-key-rotation.sql`) but wiring it to ANON/SERVICE keys adds
significant complexity. Immediate rotation (old revoked atomically when new is issued)
is the safe default; grace-period can be added as a follow-on using the existing table.

## Risks / Trade-offs

**Risk: APISIX key-auth consumer cache has a stale-key window after revocation.**
Mitigation: The Lua lookup function queries Postgres on every cache miss and on
every request where `revoked_at IS NOT NULL` in the cached record. A short TTL
(`APP_KEY_CACHE_TTL_SECONDS` default 10s) bounds the stale window. A synchronous
revocation path (cache purge via APISIX admin API) is added for explicit revoke
operations so the window collapses to near-zero in practice.

**Risk: ANON keys are dangerous if RLS policies are missing or misconfigured.**
Mitigation: The credential-issuance endpoint MUST verify that at least one RLS
policy exists for the target workspace before minting an ANON key; if none exists
it returns 422 with `code: ANON_KEY_REQUIRES_RLS`. This couples the change to
`add-console-rls-policies` at issuance time, not at deploy time.

**Risk: Per-key rate-limit budget is stored in the key record; changing the budget
requires a re-mint or a direct DB update.**
Mitigation: Add a `PATCH /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-policy`
endpoint (budget update only, no new secret) as a follow-on. For this change,
budget is set at issuance time and is immutable.
