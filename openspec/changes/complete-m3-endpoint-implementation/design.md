## Goals

1. The two contract-declared routes (`GET /v1/secrets/{domain}/{path}`,
   `GET /v1/secrets/inventory`) and the route the only consumer actually calls
   (`GET /v1/secrets/workspaces/{workspaceId}/metadata`) resolve to a real
   handler that returns metadata sourced from Vault — never secret material.
2. The runtime lives in one service, with one Vault token, scoped to the
   `metadata/` sub-path so it is structurally incapable of leaking values.
3. The gateway enforces a single new scope `secret:metadata:read` for all
   three routes, so authorisation is a contract concern, not a handler concern.

## Non-goals

- **Mutation surface** (`POST/PUT/DELETE /v1/secrets/*`). M3 contracts declare
  GETs only; rotation/write live with M2 and the orchestrator.
- **Vault data-API proxy.** This service is metadata-only by design; the Vault
  token is provisioned without `read` on `secret/data/*`.
- **Cross-tenant inventory.** `domain=platform` lists are operator-only via the
  separate `platform:admin:secrets:list` scope (out of scope here, deferred to
  `harden-m3-security-and-pagination`).
- **OpenAPI 3.0.3 → 3.1.0 schema rewrite.** Handled in
  `fix-m3-contract-schema-conformance` (and consumed by the new fragment here
  once landed).

## Where the runtime lives

`services/secret-metadata-api/` follows the same shape as the other small
Node services in `services/` (e.g., `services/secret-audit-handler/`):

- `src/server.mjs` — Fastify server, listens on `PORT` (default 8643).
- `src/routes/` — one file per route: `secret-detail.mjs`, `secret-inventory.mjs`,
  `workspace-metadata.mjs`.
- `src/vault-metadata-client.mjs` — wraps `node-vault` against `VAULT_ADDR`
  with the `secret-metadata-api-ro` policy attached to its token.
- `src/audit-emitter.mjs` — publishes `secret.metadata.read` events to the
  M2 topic at one call per successful read; failures are logged but do not
  fail the read (audit is best-effort to keep the read path fast).

## Vault metadata API integration

The Vault KV-v2 engine exposes `metadata/{mount}/{path}` (GET) and
`metadata/{mount}/` (LIST), returning `created_time`, `updated_time`,
`current_version`, `custom_metadata`, and the mount config — never the
secret value. The handler maps these to the OAS response shape declared by
`secret-metadata-v1.yaml` after `fix-m3-contract-schema-conformance` lands:

- Vault `created_time` → `createdAt`.
- Vault `updated_time` → `updatedAt`.
- Vault `custom_metadata.lastAccessedAt` → `lastAccessedAt` (null when absent).
- Vault `custom_metadata.status` → `status` (constrained by the enum
  introduced in `fix-m3-contract-schema-conformance`).
- Vault `custom_metadata.secretType` → `secretType` (likewise).
- Vault mount config `accessor` + path → `vaultMount`.
- Vault `accessPolicies` (read from the policy-binding table maintained by
  the orchestrator) → `accessPolicies[]`.

The client refuses to construct a URL for `secret/data/*` so a bug elsewhere
cannot trick it into exfiltration.

## Auth / scope model

- Gateway plugin: `keycloak-openid` with `required_scopes:
  [secret:metadata:read]`.
- Workspace-scoped route additionally requires the gateway-injected
  `x-falcone-workspace-id` header to match the path parameter; mismatch
  returns 403 at the handler layer (defence in depth).
- Tenant inventory (`?tenantId=...`) requires the caller's tenant context
  to match `tenantId`; cross-tenant inventory requires the elevated scope
  `platform:admin:secrets:list` (declared, gating deferred to
  `harden-m3-security-and-pagination`).

## Out-of-scope notes

This change wires the runtime against the *current* (broken) schemas. It
intentionally does not fix B3/B4/B5/B6/B8 — those are owned by
`fix-m3-contract-schema-conformance` and `harden-m3-security-and-pagination`.
The two changes are sequenced so this one lands first (introducing the
service), the fix changes then tighten the contracts the service serves.
