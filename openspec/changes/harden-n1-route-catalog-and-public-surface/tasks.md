## 1. Failing tests

- [ ] 1.1 [test] Add a Lua spec under
      `services/gateway-config/tests/plugins/` that simulates a 404 from the
      capability-resolution endpoint and asserts the plugin returns
      `503 GW_CAPABILITY_RESOLVER_ENDPOINT_MISSING`, not the generic
      `503 GW_CAPABILITY_RESOLUTION_DEGRADED`; today the test fails because
      all non-200 conflate (proves B13).
- [ ] 1.2 [test] Add a CI check that fails if
      `services/gateway-config/tests/capability-enforcement.test.mjs` exists
      while `tests/plugins/capability-enforcement-lua-runtime_spec.lua` (or
      equivalent) is missing — i.e., the JS shim cannot ship without an
      equivalent Lua-runtime test (proves B15).
- [ ] 1.3 [test] Add `services/gateway-config/tests/route-family-consistency.test.mjs`
      that loads every `routes/*.yaml` and asserts each route declares a
      `family:` field whose declared scopes, rate limits, and upstreams match
      the named profile in `base/public-api-routing.yaml`; today the test
      fails on all 8 route files (proves G1).
- [ ] 1.4 [test] Add a catalog-drift test that re-derives the expected
      catalog from `routes/*.yaml` + the umbrella chart and compares against
      `public-route-catalog.json`, failing on drift; today the test fails
      because the catalog has no `version` field and is incomplete (proves
      G-S6.1, G-S6.2).

## 2. Implementation

- [ ] 2.1 [fix] Replace the generic non-200 handler at
      `plugins/capability-enforcement.lua:141-143` with a switch on HTTP
      status: 404 → `GW_CAPABILITY_RESOLVER_ENDPOINT_MISSING`, 401 →
      `GW_CAPABILITY_RESOLVER_UNAUTHENTICATED`, 5xx →
      `GW_CAPABILITY_RESOLVER_UPSTREAM_ERROR`; reserve the existing
      `GW_CAPABILITY_RESOLUTION_DEGRADED` for circuit-open / timeout
      (resolves B13).
- [ ] 2.2 [migration] Move the test logic from
      `tests/capability-enforcement.test.mjs` into a Lua-runtime spec under
      `tests/plugins/`; delete the JS shim (resolves B15).
- [ ] 2.3 [impl] Add a `family:` field to every route in
      `services/gateway-config/routes/*.yaml`; wire the consistency check
      added in 1.3 (resolves G1).
- [ ] 2.4 [impl] Add `version`, `generated_at`, and `source_commit` fields
      to `services/gateway-config/public-route-catalog.json`; add a
      regenerator script that operators run when the route YAMLs change
      (resolves G-S6.1, G-S6.2).

## 3. Validation

- [ ] 3.1 [docs] Document the error-code differentiation, the family-field
      contract, and the catalog regeneration runbook in
      `services/gateway-config/README.md`.
- [ ] 3.2 [test] Run the four new tests; run
      `openspec validate harden-n1-route-catalog-and-public-surface --strict`;
      all green before merge.
