## Source repository

- [x] Point kind route 2006 at the executor; add the route-local verifier and policy plugins.
- [x] Keep route 2006-key unchanged.
- [x] Test the kind route and executor workspace binding.

## Deployment repository and release gates

- [ ] Implement and mount the issuer-allowlisted APISIX verifier with bounded JWKS cache.
- [ ] Render chart route 2006 with the same verifier and executor upstream; provide the explicit realm configuration and keep 2006-key unchanged.
- [x] Add source-side chart/kind parity, kind pod wiring, and live APISIX round-trip tests.
- [ ] Pass the kind pod wiring test and run the live APISIX round trip after the chart kind profile mounts the plugin and config overlay.
- [ ] Resolve the unmodified gateway-policy unit test failure: it still requires openid-connect on route 2006, while this change requires issuer-jwks-auth instead. The policy package is outside this ChangeSet's permitted edits.
- [ ] Render staging and prod with their own platform and tenant issuer lists, and configure the executor verifier for those realms.
- [ ] Update the staging standalone ConfigMap only through the operator-gated release process and record its SHA.
