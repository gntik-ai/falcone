## Why

Tenant wildcard paths at the gateway have no APISIX-level tenant-binding check
and delegate isolation entirely to the upstream service. From
`openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **G-S5.6** (`services/gateway-config/routes/backup-admin-routes.yaml:2-200`,
  `routes/platform-admin-routes.yaml:1-42`) — tenant wildcard routes
  (`/v1/admin/tenants/*/config/...`, `/v1/tenants/*/backup/scope`) use `*` to
  match any tenant. No APISIX-level check enforces that the wildcard segment
  matches the JWT's `tenant_id` claim. Isolation depends entirely on the
  upstream service. If the upstream regresses, the gateway leaks
  cross-tenant access.

## What Changes

- Extend `scope-enforcement.lua` to recognise a `tenant_binding: path_segment`
  config on a route and assert that the URI's tenant wildcard segment matches
  the JWT's `tenant_id` claim (with the platform-admin bypass already
  established by `complete-n1-plugin-classifier-stubs`).
- Annotate every tenant wildcard route in `routes/*.yaml` with
  `tenant_binding: { segment_index: <N>, claim: tenant_id }` so the plugin
  knows which path segment carries the tenant id.
- Add a CI check that every route whose path matches `**/tenants/*/**`
  carries a `tenant_binding` declaration.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: tenant wildcard routes MUST carry a
  `tenant_binding` declaration; the scope-enforcement plugin MUST reject
  requests whose URI tenant segment does not match the JWT `tenant_id` claim
  (with platform-admin bypass).

## Impact

- Affected code: `services/gateway-config/plugins/scope-enforcement.lua`
  (new check function); every route file under
  `services/gateway-config/routes/` that contains `/tenants/*` (add
  `tenant_binding` field); a new CI check under
  `services/gateway-config/tests/`.
- Cross-cutting: relies on the platform-admin bypass shipping correctly per
  `complete-n1-plugin-classifier-stubs`; until that ships, the bypass
  fallback MUST preserve the current `claims.role == "platform_admin"`
  semantics so platform admins are not locked out.
- Breaking changes: a caller whose JWT `tenant_id` does not match the URI
  tenant segment will now get `403 TENANT_BINDING_MISMATCH`; today the same
  call would reach the upstream and rely on the upstream's check.
- Out of scope: workspace-binding (already partially handled by the existing
  `workspace_scoped: true` config); URI parameter extraction hardening
  (covered by `harden-n1-jwt-and-claim-trust`).
