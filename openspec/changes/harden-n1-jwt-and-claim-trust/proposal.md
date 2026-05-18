## Why

Both APISIX Lua plugins trust JWT claims wholesale and extract identity from
raw URI matches, and the family manifest's header allow-list diverges from
the propagation list. From `openspec/audit/cap-n1-apisix-gateway-configuration.md`:

- **B11** (`services/gateway-config/plugins/scope-enforcement.lua:35-49`,
  `plugins/capability-enforcement.lua:66-76`) — both plugins extract claims
  from `ctx.var.jwt_claims | ctx.jwt_auth_payload | ctx.authenticated_consumer.claims`
  without independently verifying the JWT signature; if `keycloak-openid-connect`
  is misconfigured per-route, claims are forgeable.
- **B12** (`plugins/scope-enforcement.lua:66`) — `extract_workspace_id()` uses a
  naive regex on the URI; first-match semantics; query-param/header bypass
  possible if downstream uses anywhere-in-request workspace id.
- **B14** (`base/public-api-routing.yaml:439-446`) — `allowedRequestHeaders`
  anchor (`&a2`) omits `X-Auth-Scopes` and `X-Actor-Roles`, but the
  `propagatedHeaders` anchor (`&a1`, `:211-218`) includes them. Asymmetric
  inbound vs internal-propagation lists.
- **B16** (`plugins/scope-enforcement.lua:278`) — workspace-scope check
  silently skips when `claims.workspace_id` is missing; combined with B11,
  a forged JWT with no `workspace_id` reaches upstream without a workspace
  check.
- **B17** (`plugins/scope-enforcement.lua:212`) — function-subdomain
  enforcement returns early when `required_subdomain == nil`; unclassified
  routes pass with no audit.
- **G-S4.2**, **G-S4.4**, **G-S4.5** — same findings restated as security gaps.

## What Changes

- Require both plugins to refuse to run if `ctx.jwt_verified ~= true` (or an
  equivalent verification flag the OIDC plugin sets); add a CI check that
  every route in `routes/*.yaml` has `keycloak-openid-connect` configured to
  set the flag.
- Replace the naive URI regex at `:66` with a stricter extractor that consults
  the request path against the route's declared parameter spec; reject when
  the URI parameter conflicts with the JWT claim.
- Reconcile the `allowedRequestHeaders` and `propagatedHeaders` anchors in
  `base/public-api-routing.yaml` so identity headers in the propagation list
  appear in the allow list (or vice-versa — drop from propagation if not
  intended).
- Fail closed at `:278` and `:212`: missing `claims.workspace_id` on a
  workspace-scoped route MUST return `403 WORKSPACE_CLAIM_MISSING`; missing
  `required_subdomain` on a function-subdomain-scoped route MUST emit an
  audit event with `audit_only=true` and either deny (configurable) or pass
  with the event recorded.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: both plugins MUST require an upstream-set
  JWT-verified flag before trusting claims; workspace and subdomain checks
  MUST fail closed on missing claim; header anchors MUST be consistent.

## Impact

- Affected code: `services/gateway-config/plugins/scope-enforcement.lua`
  (`:35-49`, `:66`, `:212`, `:278`); `plugins/capability-enforcement.lua`
  (`:66-76`); `base/public-api-routing.yaml` (`:211-218`, `:439-446`); a new
  CI check under `services/gateway-config/tests/`.
- Cross-cutting: depends on `keycloak-openid-connect` actually exposing a
  verification flag in `ctx`; if the flag name differs, document the
  contract.
- Breaking changes: forged or test JWTs that lack `workspace_id` will start
  receiving 403 on workspace-scoped routes; previously they silently
  bypassed.
- Out of scope: classifier stubs (covered by
  `complete-n1-plugin-classifier-stubs`); plugin defaults (covered by
  `fix-n1-plugin-defaults-and-naming`); catalog drift (covered by
  `harden-n1-route-catalog-and-public-surface`).
