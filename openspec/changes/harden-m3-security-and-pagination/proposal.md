## Why

Beyond schema correctness, the M3 contracts are silent on authorization,
on pagination, on cross-route field parity, and on OpenAPI dialect. From
`openspec/audit/cap-m3-secret-metadata-api-contracts.md`:

- **B8** (`secret-metadata-v1.yaml:1-43` + `secret-inventory-v1.yaml:1-60`) —
  neither YAML declares `components.securitySchemes` or a top-level
  `security` block. No scope is named in the contract; whoever implements
  it must guess.
- **B10** (`secret-inventory-v1.yaml:35-42`) — inventory 200 shape is bare
  `{secrets: [...]}` with no `total`, `nextOffset`, `hasMore`, or `Link`
  header. The contract supports `offset`/`limit` but tells consumers
  nothing about how to detect end-of-list.
- **B12** (`secret-inventory-v1.yaml:45-59`) — `SecretMetadataItem` lacks
  `lastAccessedAt`, `vaultMount`, `accessPolicies` — fields the detail
  endpoint carries. Inventory consumers must N+1 the detail route.
- **B14** (`secret-metadata-v1.yaml:1` and `secret-inventory-v1.yaml:1`) —
  both YAMLs declare `openapi: 3.0.3`; the unified spec
  `apps/control-plane/openapi/control-plane.openapi.json` is `3.1.0`. The
  fragment introduced by `complete-m3-endpoint-implementation` must be
  3.1.0 or it cannot merge.
- **G-S3.4, G-S3.5** — undocumented N+1 and undefined `tenantId`-omitted
  behaviour.

## What Changes

- Declare `components.securitySchemes.bearerAuth` (OAuth2 bearer with
  Keycloak issuer) and a top-level `security: [bearerAuth: [secret:metadata:read]]`
  on both YAMLs and on the unified-spec fragment introduced by
  `complete-m3-endpoint-implementation`.
- Define a `platform:admin:secrets:list` scope that the inventory endpoint
  additionally requires when `tenantId` is omitted, formalising "list
  across tenants" as an operator-only operation.
- Expand the inventory 200 envelope to `{secrets: [...], pagination:
  {total, offset, limit, nextOffset, hasMore}}` so end-of-list is detectable
  without N+1.
- Add `lastAccessedAt`, `vaultMount`, `accessPolicies` to
  `SecretMetadataItem` so inventory consumers have parity with the detail
  payload (the underlying Vault read returns them in a single LIST anyway).
- Migrate both contracts to `openapi: 3.1.0` so the fragment merged into
  the unified spec doesn't suffer the 3.0.3↔3.1.0 nullable/JSON-Schema
  divergence.

## Capabilities

### Modified Capabilities

- `secret-management`: requirement on the security scheme + scope set, on
  the inventory pagination envelope, on `SecretMetadataItem` field parity
  with detail, and on the OAS 3.1.0 dialect.

## Impact

- **Affected code**: `services/internal-contracts/secrets/secret-metadata-v1.yaml`,
  `services/internal-contracts/secrets/secret-inventory-v1.yaml`, the
  unified-spec fragment under `apps/control-plane/openapi/families/secrets.openapi.json`,
  and `services/keycloak-config/scopes/platform-realm.yaml` (new scope
  `platform:admin:secrets:list`).
- **Migration required**: existing Keycloak realm picks up the new scope at
  the next reconciliation pass; no data migration.
- **Breaking changes**: callers that relied on the bare `{secrets: [...]}`
  envelope must adapt to the `pagination` wrapper; operators listing across
  tenants must hold the new admin scope.
- **Cross-cutting**: depends on `complete-m3-endpoint-implementation` for the
  fragment to harden; if implemented before that change, the YAML edits
  stand alone.
