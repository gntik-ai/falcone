## Context

`services/gateway-config/plugins/scope-enforcement.lua` exposes two extension
points the enforcement codepath calls into:

```lua
function _M.fetch_endpoint_privilege_domain(_, _) return nil end
function _M.fetch_endpoint_function_subdomain(_, _) return nil end
```

The functions are deliberate stubs — the plugin author wrote the enforcement
algorithm assuming an external classifier would be wired later. None has been
wired. Meanwhile, the gateway already ships a canonical-shaped artefact for
this exact purpose: `services/gateway-config/public-route-catalog.json` already
classifies 32 routes into `privilege_domain ∈ {structural_admin, data_access}`
plus `function_privilege_subdomain ∈ {function_deployment}`. The classifier
implementation is therefore "load the JSON and answer questions about it" —
not a new data model.

## Goals

- Wire `fetch_endpoint_privilege_domain` and `fetch_endpoint_function_subdomain`
  to a single classifier that reads `public-route-catalog.json` (or its HTTP
  equivalent published by the provisioning-orchestrator).
- Honour the same wildcard semantics as `capability-enforcement.lua` (`*` →
  `[^/]+`, exact-match preferred over wildcard).
- Cache the classifier table per worker for the same TTL the plugin already
  uses for scope requirements (60 s default per `base/public-api-routing.yaml:468-472`).
- Fix the realm-role bypass at `:163` so a legitimate platform admin never
  hits the `CONFIG_ERROR` branch when the catalog is incomplete.

## Non-goals

- Completing the catalog itself (covered by
  `harden-n1-route-catalog-and-public-surface`); this proposal accepts the
  known-incomplete 32-entry v1.
- Changing the wire shape of `public-route-catalog.json`.
- Re-implementing the `evaluate_privilege_domain` / `evaluate_function_subdomain`
  callers — they keep the same control flow.

## Decisions

### Decision 1: Catalog source

The classifier MUST consume `public-route-catalog.json` as the source of truth
when `CATALOG_HTTP_URL` is unset, and MUST consume an HTTP endpoint when set.
The HTTP path lets the provisioning-orchestrator publish updates without a
gateway redeploy; the file path keeps the existing GitOps flow working for
small deployments.

### Decision 2: Lookup algorithm

1. Index the catalog by `(method, exact-path)` — primary lookup.
2. Fall back to wildcard match against entries whose `path` contains `*`,
   converted to `^...[^/]+...$` regex following the same rule as
   `capability-enforcement.lua:59`.
3. On no match, return `nil` — this signals "unclassified", which the existing
   plugin handles as `CONFIG_ERROR` for non-bypass callers and `pass` for
   platform admins (see Decision 3).

### Decision 3: Platform-admin bypass claim path

Replace `claims.role == "platform_admin"` with a check that:

1. Reads the realm-roles claim under a configurable JWT path
   (default: `realm_access.roles`).
2. Normalises both the claim values and the configured admin role names
   case-insensitively.
3. Short-circuits with `pass` BEFORE the `required_domain == nil` branch fires,
   so a platform admin never receives `CONFIG_ERROR` for an unclassified route.

### Decision 4: Contract with provisioning-orchestrator

When `CATALOG_HTTP_URL` is set, the classifier MUST treat a 4xx/5xx response
as "catalog unavailable" and fall back to the bundled `public-route-catalog.json`
shipped with the chart, emitting a single warning per worker. The plugin MUST
NOT fail open to "everyone passes" on catalog fetch failure — that would
silently disable enforcement.

## Risks / Trade-offs

- The bundled file can drift from the HTTP source. Decision 4 prefers stale
  enforcement over silent failure; operators can detect drift via the warning
  metric.
- `[^/]+` wildcard doesn't support multi-segment paths. The current catalog
  doesn't need it; document the limit and revisit if a future route requires
  `**`-style matching.
- Case-insensitive role match increases attack surface marginally (a role named
  `Platform_Admin` now bypasses where it didn't before). Mitigated by Keycloak
  realm-role administration being a privileged action in itself.

## Migration plan

1. Land the classifier behind `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false`
   (current default) so behaviour is unchanged.
2. Run the classifier in shadow mode emitting denial events without 403s for
   one release.
3. Flip enforcement on per-environment, starting with non-prod, after operators
   confirm zero shadow-mode denials for legitimate traffic.
