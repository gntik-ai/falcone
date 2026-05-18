## Why

The M3 contracts at `services/internal-contracts/secrets/` declare two GET
routes — `/v1/secrets/{domain}/{path}` and `/v1/secrets/inventory` — but no
runtime serves them, no gateway routes them, and no unified-spec fragment
references them. From `openspec/audit/cap-m3-secret-metadata-api-contracts.md`:

- **B1** (`secret-metadata-v1.yaml:6-19` + `secret-inventory-v1.yaml:6-29`) —
  `grep -rln "/v1/secrets/" services apps` returns no handler. The two
  declared endpoints have no implementation in source.
- **B2** (verified by grep on `services/gateway-config/routes/` and
  `apps/control-plane/openapi/families/`) — no gateway route declares
  `/v1/secrets/*`, and no control-plane OpenAPI fragment references the M3
  YAMLs. Even with a handler, no traffic would reach it.
- **B7** (`tests/hardening/suites/tenant-isolation.test.mjs:38,52`) — the only
  consumer of `/v1/secrets/*` calls `/v1/secrets/{workspaceId}/metadata`,
  a path neither contract declares. The test passes against nothing.
- **G-cross.1** — no consumer of `secret-metadata-v1.yaml` /
  `secret-inventory-v1.yaml` exists; both files are documentation.
- **G-cross.2** — the audit-event contract has only a divergent consumer in
  M2 (`services/secret-audit-handler/`) whose JS schema differs.

## What Changes

- Stand up `services/secret-metadata-api/` (new) that exposes the two declared
  routes plus a workspace-scoped `/v1/secrets/workspaces/{workspaceId}/metadata`
  route to absorb the hardening test's call shape (resolving B7).
- Wire a `secrets.openapi.json` fragment under `apps/control-plane/openapi/families/`
  that re-emits the two YAMLs as 3.1.0 operations and is merged into
  `control-plane.openapi.json`.
- Add gateway routes under `services/gateway-config/routes/secrets.yaml` with the
  `keycloak-openid` plugin requiring a new scope `secret:metadata:read`.
- Bind the Vault metadata API as the read-only source — never the secret-data
  API. The service holds a Vault token scoped to the `metadata/` sub-path only.

## Capabilities

### Modified Capabilities

- `secret-management`: requirement on a runtime serving the two declared
  metadata routes, on the workspace-scoped metadata route that the hardening
  test consumes, on gateway routing, and on the Vault metadata-only binding.

## Impact

- **Affected code**: new `services/secret-metadata-api/` (Node service);
  new `apps/control-plane/openapi/families/secrets.openapi.json`;
  new `services/gateway-config/routes/secrets.yaml`;
  rewrite of `tests/hardening/suites/tenant-isolation.test.mjs:38,52` to call
  the now-declared route.
- **Migration required**: a Vault policy `secret-metadata-api-ro` granting
  `read` on `metadata/*` paths only; a Keycloak scope `secret:metadata:read`
  added to the platform realm manifest.
- **Breaking changes**: the hardening test stops being a contract violation;
  callers that previously got a 404 from the undocumented path get 200.
- **Cross-cutting**: see `harden-m3-security-and-pagination` for the auth
  contract and pagination-envelope hardening of the new routes; see
  `fix-m3-contract-schema-conformance` for the schema corrections that this
  new fragment must adopt.
