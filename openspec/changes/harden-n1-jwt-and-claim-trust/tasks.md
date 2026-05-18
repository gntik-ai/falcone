## 1. Failing tests

- [ ] 1.1 [test] Add a Lua spec under
      `services/gateway-config/tests/plugins/` that invokes
      `scope-enforcement.lua` with `ctx.jwt_verified = nil` and asserts the
      plugin returns `401 UNAUTHENTICATED`; today the plugin runs against the
      claims regardless (proves B11, G-S4.4).
- [ ] 1.2 [test] Add a spec asserting that a JWT without `workspace_id` on a
      workspace-scoped route returns `403 WORKSPACE_CLAIM_MISSING`; today the
      check silently skips at `scope-enforcement.lua:278` (proves B16).
- [ ] 1.3 [test] Add a YAML-anchor test that asserts every header in
      `propagatedHeaders` (`&a1`) appears in `allowedRequestHeaders` (`&a2`);
      today the test fails on `X-Auth-Scopes` and `X-Actor-Roles` (proves
      B14).

## 2. Implementation

- [ ] 2.1 [fix] Update both plugins (`scope-enforcement.lua:35-49`,
      `capability-enforcement.lua:66-76`) to require
      `ctx.jwt_verified == true` (or equivalent OIDC-plugin flag); return
      `401 UNAUTHENTICATED` otherwise (resolves B11).
- [ ] 2.2 [fix] Replace the URI workspace extractor at
      `scope-enforcement.lua:66` with a parameter-spec-aware extractor that
      consults the route's declared path template; reject if the URI value
      and the JWT `workspace_id` disagree (resolves B12).
- [ ] 2.3 [fix] Change the workspace-scope branch at `:278` to fail closed:
      missing `claims.workspace_id` on a workspace-scoped route MUST return
      `403 WORKSPACE_CLAIM_MISSING` with an audit event (resolves B16).
- [ ] 2.4 [fix] Change the function-subdomain branch at `:212`: missing
      `required_subdomain` MUST emit an audit event; the deny-vs-pass decision
      MUST be controlled by a plugin config flag with `deny` as the default
      (resolves B17, G-S4.5).
- [ ] 2.5 [fix] Add `X-Auth-Scopes` and `X-Actor-Roles` to the
      `allowedRequestHeaders` anchor (`&a2`) at
      `base/public-api-routing.yaml:439-446` so the propagation and allow
      lists are consistent (resolves B14).

## 3. Validation

- [ ] 3.1 [docs] Document the JWT-verification contract, the new
      workspace-claim fail-closed semantics, and the header anchor
      reconciliation in `services/gateway-config/README.md`.
- [ ] 3.2 [test] Re-run the Lua specs and the anchor test; run
      `openspec validate harden-n1-jwt-and-claim-trust --strict`; all green
      before merge.
