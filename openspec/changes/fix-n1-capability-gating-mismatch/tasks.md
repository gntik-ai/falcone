## 1. Failing tests

- [ ] 1.1 [test] Add `services/gateway-config/tests/gate-route-parity.test.mjs`
      that loads `routes/capability-gated-routes.yaml` and asserts every gate
      key resolves to at least one route declaration in any other
      `routes/*.yaml` (and, conversely, every route annotated with a gated
      capability appears in the gates manifest). Today the test fails on
      `realtime`, `functions_public`, and at least one other gate (proves B9,
      G5).
- [ ] 1.2 [test] Add a Lua spec under `tests/plugins/` that sends a request
      with a spoofed `X-Tenant-Id` header and asserts the header is stripped
      (or rewritten from the JWT claim) before the upstream sees it; today
      the test fails because no plugin enforces
      `rejectSpoofedContextHeaders` (proves B10, G-S2.2).

## 2. Implementation

- [ ] 2.1 [impl] Either ship new APISIX route YAMLs for every gated path
      missing in the chart, or remove the orphan gate entries from
      `routes/capability-gated-routes.yaml:15-43`; the parity test from 1.1
      MUST pass at the end (resolves B9).
- [ ] 2.2 [impl] Implement context-header stripping for the seven identity
      headers (`X-Tenant-Id`, `X-Workspace-Id`, `X-Plan-Id`,
      `X-Auth-Subject`, `X-Actor-Username`, `X-Auth-Scopes`, `X-Actor-Roles`)
      in either a new `plugins/context-header-stripper.lua` or by extending
      `scope-enforcement.lua` (resolves B10).
- [ ] 2.3 [fix] Wire the new plugin (or the extension) into every family
      profile in `base/public-api-routing.yaml` whose
      `requestValidationProfile.rejectSpoofedContextHeaders` is `true`.

## 3. Validation

- [ ] 3.1 [docs] Document the gate/route parity contract and the
      header-stripping plugin in `services/gateway-config/README.md`.
- [ ] 3.2 [test] Run the parity and header-strip tests; run
      `openspec validate fix-n1-capability-gating-mismatch --strict`; all
      green before merge.
