## Why

The gateway ships permissively by default and silently differs between route
files. From `openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B6** (`services/gateway-config/plugins/capability-enforcement.lua:43`) —
  route-key construction is `(route.method or "*") .. ":" .. (route.path or "")`.
  If a path template contains a literal `:` (APISIX radixtree permits this),
  the key delimiter becomes ambiguous and lookup collides.
- **B7** (`services/gateway-config/helm/values.yaml:1, :5`) —
  `scopeEnforcement.enabled: false` and `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED:
  "false"`. Both APISIX plugins ship disabled by default; a fresh deploy runs
  without scope enforcement.
- **B8** (`services/gateway-config/routes/backup-audit-routes.yaml:6`) — uses
  plugin name `openid-connect`; every other route file uses
  `keycloak-openid-connect`. APISIX has both as separately-named plugins; the
  backup-audit route silently differs from siblings (scope-claim mapping,
  discovery defaults).
- **G3**, **G-S2.1**, **G-S5.4** — same findings restated as cross-cutting gaps.

## What Changes

- Reconstruct the capability-enforcement route-key with a non-colon delimiter
  (e.g. `\x1f` or `${method}${path}`) so a literal `:` in the path
  cannot collide with the method/path separator.
- Flip `scopeEnforcement.enabled` to `true` in
  `services/gateway-config/helm/values.yaml`. The privilege-domain enforcement
  default stays `"false"` until `complete-n1-plugin-classifier-stubs` ships
  (turning it on without classifiers 403s the surface — see B2).
- Rename the `openid-connect` plugin reference in
  `services/gateway-config/routes/backup-audit-routes.yaml:6` to
  `keycloak-openid-connect` so backup-audit aligns with sibling routes.
- Add a CI check that asserts a single plugin name is used for OIDC across
  all route files.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: route-key construction in
  capability-enforcement MUST use a path-safe delimiter; scope-enforcement
  MUST be enabled by default; the OIDC plugin name MUST be uniform across
  every route file.

## Impact

- Affected code: `services/gateway-config/plugins/capability-enforcement.lua`
  (`:43`); `services/gateway-config/helm/values.yaml` (`:1`);
  `services/gateway-config/routes/backup-audit-routes.yaml` (`:6`); new CI
  check under `services/gateway-config/tests/`.
- Migration: operators currently overriding `scopeEnforcement.enabled` to
  `true` no longer need the override; clusters that depended on the old
  permissive default to silence misconfigured calls MUST audit and grant the
  required scopes before merge.
- Breaking changes: enabling scope-enforcement by default may surface latent
  misconfigurations as 403s in environments that never enabled the plugin;
  document a rollback override in the migration runbook.
- Out of scope: privilege-domain default flip (depends on
  `complete-n1-plugin-classifier-stubs`); JWT trust (covered by
  `harden-n1-jwt-and-claim-trust`).
