# add-tenant-api-keys

## Why

Every commercially successful BaaS — Supabase, Firebase, Appwrite, Pocketbase — exposes
**tenant-scoped API keys** that client SDKs can ship in front-end code: a low-privilege
*publishable* key (`anon`) that always submits to per-row policies, and a high-privilege
*service-role* key intended only for trusted servers and CI.

Falcone today only models human operators and OpenWhisk service accounts (capability
[[identity-and-access]]). There is no first-class key type that a tenant can mint, embed
in a JavaScript bundle, hand to a CI job, or rotate without touching Keycloak. This makes
it impossible for an external developer to call `/v1/postgres/...`, `/v1/storage/...`,
`/v1/functions/.../invoke`, or the future Auto REST API ([[add-auto-rest-data-api]])
without going through the human-operator login flow — which closes the door on the entire
client-SDK pattern that BaaS adopters expect.

Adding API keys is the **foundational unlock** for every other BaaS-shaped proposal in this
batch: PostgREST-style data access ([[add-auto-rest-data-api]]), passwordless self-service
sign-up ([[add-passwordless-and-social-auth]]), messaging webhooks ([[add-transactional-messaging]]),
and push-notification device registration ([[add-push-notifications]]) all assume that an
unauthenticated browser or mobile client can present an `apikey` header and that the gateway
can resolve it to a tenant/workspace context with a known scope set.

## What Changes

1. **New key types in `identity-and-access`.** Introduce two tenant-mintable key kinds:
   - `publishable` — meant to ship in client code; carries the `data_access:anon` scope only;
     all data-plane calls are subject to Postgres RLS or storage bucket policies.
   - `service_role` — meant for trusted servers; carries broad `data_access` and selected
     admin scopes; explicitly **never** subject to RLS at the data API.
2. **New endpoints under `/v1/workspaces/{workspaceId}/api-keys`** (workspace-scoped because
   keys must resolve to one workspace context):
   - `POST .../api-keys` — mint key. Body: `{ kind, label, scopes?, expiresAt? }`. Returns the
     plaintext key **once**, plus `keyId`, fingerprint, and metadata.
   - `GET .../api-keys` — list (metadata only, never the plaintext value).
   - `GET .../api-keys/{keyId}` — single key metadata.
   - `PATCH .../api-keys/{keyId}` — rename, disable, change expiry, rotate (returns new
     plaintext).
   - `DELETE .../api-keys/{keyId}` — revoke immediately.
   - `GET /v1/workspaces/{workspaceId}/api-keys/{keyId}/usage` — 30-day usage rollup.
3. **APISIX `tenant-api-key` plugin.** Resolves header `apikey: <opaque>` or
   `Authorization: Bearer sbp_<opaque>` to a `tenantId / workspaceId / kind / scopes`
   security context **before** the keycloak-openid plugin runs. If both an API key and an
   operator bearer token are present, operator token wins. The plugin sets request headers
   `x-falcone-tenant-id`, `x-falcone-workspace-id`, `x-falcone-actor-kind=api_key`,
   `x-falcone-key-kind`, `x-falcone-key-id` for downstream services.
4. **Storage and rotation.** Keys are stored hashed (argon2id), surfaced once at creation
   and once at rotation, and never logged. The rotation flow reuses the existing
   `credential_rotation_state` machinery from [[plan-tenant-provisioning]].
5. **Quota & rate limits.** Plan tier governs (a) maximum number of active keys per kind
   per workspace and (b) per-key request rate. Enforced by APISIX `limit-req` keyed on
   `x-falcone-key-id`.
6. **Audit.** Every mint/rotate/revoke emits an `iam_lifecycle_event` (subtype
   `iam.api_key.*`) so [[observability-and-audit]] consumes them with the same SLA as
   user lifecycle events. Every authenticated request the key makes is tagged with
   `actor.kind=api_key` and `actor.id=<keyId>` so existing audit pipelines just work.

## Impact

- **Affected specs**:
  - `openspec/specs/identity-and-access/spec.md` — adds REQs for key kinds, gateway
    resolution, lifecycle endpoints, audit emission.
  - `openspec/specs/secret-management/spec.md` — adds REQs for argon2id hashing,
    one-time disclosure, rotation, and the canonical secret entry in the secret catalog.
- **Affected code (deliverable boundaries)**:
  - `apps/control-plane/openapi/families/iam.openapi.json` — add `/v1/workspaces/{workspaceId}/api-keys/*`.
  - `services/keycloak-config/` and/or a new `services/iam-api-key-service/` — chosen in
    [[design.md]] — implements minting, hashing, rotation, listing.
  - `services/gateway-config/plugins/tenant-api-key.lua` (new APISIX plugin) and
    `services/gateway-config/routes/*.yaml` — wire the plugin in front of keycloak-openid.
  - `services/provisioning-orchestrator/src/migrations/NNN-api-keys.sql` — table
    `tenant_api_keys` (id, tenant_id, workspace_id, kind, label, hash, fingerprint,
    scopes[], status, created_by, created_at, expires_at, last_used_at, revoked_at).
  - `services/internal-contracts/src/api-key-*.json` — request/result/event contracts.
  - `apps/web-console/src/pages/ConsoleApiKeysPage.tsx` — list, mint (with one-time-reveal
    modal), rotate, revoke.
- **Cross-capability dependencies created**: every downstream `/v1/*` family becomes
  callable with `apikey` instead of an operator bearer; [[add-auto-rest-data-api]] is the
  first explicit consumer.
- **No breaking changes** — operator-token auth path is untouched; the plugin is additive.
