# Design — add-tenant-api-keys

## Goals

1. Browser-shippable `publishable` key that always passes through Postgres RLS / storage
   policies.
2. CI/server `service_role` key that bypasses RLS but is heavily audited.
3. Mint/rotate/revoke is fast (< 50ms on the hot path) so it feels native to the console.
4. No secret material in logs, ever; one-time disclosure on mint and rotate.
5. Plugin-evaluated at the gateway in O(1) memory per key with sub-millisecond auth
   overhead at p99.

## Non-goals

- **Per-row policy authoring UI** — owned by [[add-auto-rest-data-api]]; this proposal
  only assumes RLS exists and is enforced.
- **OAuth-style PKCE flows for third-party developers.** Out of scope; covered by a
  future `add-oauth-app-developer-portal` proposal.
- **Per-key billing.** Usage rollups are emitted; monetisation is owned by
  [[quota-and-billing]].

## Key format

```
sbp_v1_<base32(workspaceShortId)>_<base32(random128)>
```

- Prefix `sbp_v1` makes it grep-able in logs and source code; secret scanners (GitHub,
  GitGuardian, TruffleHog) recognise the format.
- Embedding the workspace short id lets the gateway short-circuit lookups: it hashes the
  random suffix and queries `tenant_api_keys WHERE workspace_id = ? AND hash = ?`.

Service-role keys use prefix `sbs_v1_...` so the distinction is visible in logs without
disclosing the key.

## Storage

```sql
CREATE TABLE tenant_api_keys (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('publishable', 'service_role')),
  label           text NOT NULL,
  hash            text NOT NULL,            -- argon2id($argon2id$v=19$...)
  fingerprint     text NOT NULL,            -- sha256(key)[:8] for UX
  scopes          text[] NOT NULL,
  status          text NOT NULL,            -- active | disabled | revoked
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  rotated_from_id uuid,
  UNIQUE (workspace_id, fingerprint)
);
CREATE INDEX ON tenant_api_keys (workspace_id, status) WHERE status = 'active';
```

The hash is argon2id with memory=64 MiB, t=3, parallelism=1 — same parameters as
[[secret-management]]'s baseline.

## Decision: standalone service vs. fold into existing service

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Fold into `services/keycloak-config/`** | Single IAM service to operate. | `keycloak-config/` today owns scope manifests, not runtime; would have to gain DB & APIs. |
| **B. Fold into `services/provisioning-orchestrator/`** | Already owns `tenant_*` tables and credential rotation. | Already large; further dilutes its bounded context. |
| **C. New `services/iam-api-key-service/`** | Clear bounded context; small surface (5 endpoints). | One more service to deploy. |

**Recommendation: B (provisioning-orchestrator).** Reuses `credential_rotation_state`,
`tenant_*` join keys, and existing audit emission; the bounded-context dilution is
acceptable for a ~500-LoC addition. Revisit if the surface grows beyond key lifecycle
into broader IAM (e.g., session management).

## Gateway resolution

A new APISIX plugin `tenant-api-key` runs **before** `openid-connect`:

```
1. If header `apikey` or `Authorization: Bearer sbp_*|sbs_*` present:
     a. Parse prefix + workspace short id + secret half.
     b. Look up in Redis cache (workspace_id, fingerprint) → key row.
        Cache TTL 60s; invalidation on revoke/rotate via Redis pub/sub.
     c. If miss, query Postgres `tenant_api_keys`.
     d. Verify argon2id hash in constant time.
     e. Verify status=active and (expires_at IS NULL OR now() < expires_at).
     f. Bind `x-falcone-tenant-id`, `-workspace-id`, `-actor-kind=api_key`,
        `-key-kind`, `-key-id`, `-scopes` to request context.
     g. Set `last_used_at` async (debounced to once per minute per key).
2. Else fall through to existing `openid-connect` plugin (operator path).
```

Failure modes:
- Unknown / disabled / expired → 401 with `WWW-Authenticate: Falcone-Key`.
- Service-role key on a route requiring an operator scope → 403 (gateway scope-enforcement
  plugin handles this; this plugin only resolves identity).
- Cache & DB unavailable → fail closed (401) and emit `iam.api_key.auth_unavailable`.

## RLS contract

For `publishable` keys the gateway also sets:
```
x-falcone-actor-anon: true
x-falcone-actor-subject: <NULL or end-user JWT sub from companion bearer if any>
```

The auto REST data API ([[add-auto-rest-data-api]]) is the first consumer: it sets
`SET LOCAL request.jwt.claim.role = 'anon'` (or `'authenticated'` if an end-user JWT
companion is presented) so Postgres RLS policies can discriminate. Service-role keys set
`request.jwt.claim.role = 'service_role'` and the standard RLS-bypass pattern applies.

## Rotation flow

```
PATCH /v1/workspaces/{wsId}/api-keys/{keyId}    body: {"action":"rotate"}
  → mint new secret, return plaintext exactly once
  → mark old row status=rotating, set rotated_to_id
  → emit iam.api_key.rotation_started
  → grace period (default 24h, plan-configurable up to 7d)
  → background sweep revokes the old key, emits iam.api_key.rotation_completed
```

Grace period lets tenants update consumers without downtime; auditors see both keys live
side by side during the window.

## Open questions

- **Q-AKY-01.** Should `publishable` keys be exempt from per-IP rate limits when a valid
  end-user JWT is presented as a companion (so a million-user mobile app isn't capped by
  the key's own quota)? Lean **yes** — fall back to per-`sub` rate limits in that case.
- **Q-AKY-02.** Do we let the tenant restrict `service_role` keys to a network CIDR list?
  Useful for hardening, low effort. Lean **yes** — additive field `allowedCidrs[]` on the
  row; plugin checks before audit.
- **Q-AKY-03.** Should rotation be exposed as a separate sub-resource POST instead of
  `PATCH ... {"action":"rotate"}`? The latter matches existing `set-status` patterns in
  `iam.openapi.json`. Lean **stay with PATCH** for consistency.
