## 1. Failing tests

- [ ] 1.1 [test] Add a Lua spec under `services/gateway-config/tests/plugins/`
      that loads `scope-enforcement.lua`, sets
      `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=true`, calls the access phase
      against a public-route-catalog-listed path with non-platform claims, and
      asserts the response is 200 (not `403 CONFIG_ERROR`). Today the test
      fails because `fetch_endpoint_privilege_domain` returns `nil` (proves B2,
      G-S4.1).
- [ ] 1.2 [test] Add a Lua spec asserting that a JWT carrying
      `realm_access.roles = ['platform_admin']` (regardless of `claims.role`)
      bypasses the privilege-domain check; today the test fails because the
      bypass reads `claims.role` only (proves B5).
- [ ] 1.3 [test] Add a Lua spec asserting that a JWT carrying
      `claims.role = 'Platform_Admin'` (case-mismatched) bypasses the check
      after the realm-role lookup is wired with case-insensitive normalisation.

## 2. Implementation

- [ ] 2.1 [impl] Implement `fetch_endpoint_privilege_domain` at
      `services/gateway-config/plugins/scope-enforcement.lua:120-128` to load
      `public-route-catalog.json` (file-path default, `CATALOG_HTTP_URL`
      override) and return `privilege_domain` for `(method, path)` using
      exact-then-wildcard match (resolves B2 part 1).
- [ ] 2.2 [impl] Implement `fetch_endpoint_function_subdomain` against the
      `function_privilege_subdomain` field in the same catalog (resolves B2
      part 2).
- [ ] 2.3 [fix] Replace the `claims.role == "platform_admin"` check at
      `:163` with a realm-roles lookup (`realm_access.roles` by default,
      JWT-path configurable), normalised case-insensitively, and short-circuit
      before the `required_domain == nil` branch (resolves B5).
- [ ] 2.4 [impl] Add a per-worker cache for the classifier table with the
      60 s TTL declared in `base/public-api-routing.yaml:468-472`; on HTTP
      fetch failure, fall back to the bundled JSON and emit a single warning.

## 3. Validation

- [ ] 3.1 [docs] Document the classifier wiring, the catalog source-of-truth
      precedence, and the new realm-roles JWT path config in
      `services/gateway-config/README.md`.
- [ ] 3.2 [test] Run the Lua specs added in section 1, plus
      `openspec validate complete-n1-plugin-classifier-stubs --strict`; all
      green before merge.
