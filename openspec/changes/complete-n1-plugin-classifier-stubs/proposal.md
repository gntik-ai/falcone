## Why

Privilege-domain enforcement at the gateway is a runtime trap: the two endpoint
classifiers that the scope-enforcement plugin calls are `return nil` stubs, and
the platform-admin bypass reads the wrong JWT claim. From
`openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B2** (`services/gateway-config/plugins/scope-enforcement.lua:120-128`) —
  `fetch_endpoint_privilege_domain(_, _) return nil end` and
  `fetch_endpoint_function_subdomain(_, _) return nil end`. With
  `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=true`, every route hits
  `if required_domain == nil then if enforcement_enabled then return 403
  CONFIG_ERROR` (`:154-205`). The entire surface 403s.
- **B5** (`services/gateway-config/plugins/scope-enforcement.lua:163`) —
  `claims.role == "platform_admin"` is checked as an exact-string scope literal
  against the wrong claim path. Per the B1 capability audit, `platform_admin`
  is a Keycloak realm role propagated via `$jwt_claim_realm_access_roles`, not
  `claims.role`. The bypass never fires for legitimate platform admins.
- **G-S4.1** (CRITICAL, same lines as B2) — same finding restated as a critical
  gap with the explicit chicken-and-egg: leave enforcement off and lose the
  privilege-domain control entirely; turn it on and lose the API surface.

This is a `complete-*` change because the classifier code does not exist —
there is no buggy implementation to repair; the two functions are placeholders
returning `nil`.

## What Changes

- Implement `fetch_endpoint_privilege_domain` and
  `fetch_endpoint_function_subdomain` as real classifiers that consume
  `services/gateway-config/public-route-catalog.json` (or its successor) as
  the canonical mapping of `(method, path-pattern) → privilege_domain /
  function_subdomain`.
- Wire the classifier to honour the same wildcard expansion rules the
  `capability-enforcement.lua` plugin already implements (`*` →
  `[^/]+`).
- Replace the `claims.role == "platform_admin"` bypass at `:163` with a check
  against the realm-roles claim (`realm_access.roles` or the configured JWT
  claim path), normalised case-insensitively, and document the claim path as
  part of the plugin contract.
- Honour the contract that the platform admin bypass MUST short-circuit before
  the `nil`-required-domain branch fires (i.e., a platform admin never sees
  `CONFIG_ERROR` for an unclassified route).

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: privilege-domain enforcement MUST resolve the
  required-domain for every public route from a versioned catalog; the
  platform-admin bypass MUST consult the realm-roles claim, not a single
  `claims.role` field; turning enforcement on MUST NOT 403 the whole surface.

## Impact

- Affected code: `services/gateway-config/plugins/scope-enforcement.lua`
  (classifier implementation at `:120-128`, bypass at `:163`); a new
  catalog loader either reading `public-route-catalog.json` at boot or
  consuming an HTTP endpoint published by the provisioning-orchestrator.
- Cross-cutting: design depends on the canonical route catalog (see
  `harden-n1-route-catalog-and-public-surface`) — both proposals MUST be merged
  for end-to-end enforcement, but this proposal can ship with the existing
  32-entry catalog as a known-incomplete v1.
- Breaking changes: deployments that currently override
  `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=true` to silence the 403 storm by
  also setting bypass headers will no longer need the workaround.
- Out of scope: catalog completeness (handled by
  `harden-n1-route-catalog-and-public-surface`); JWT trust hardening (handled
  by `harden-n1-jwt-and-claim-trust`).
