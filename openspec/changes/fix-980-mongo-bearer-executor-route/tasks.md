## Source repository

- [x] Point kind route 2006 at the executor; add the route-local verifier and policy plugins.
- [x] Keep route 2006-key unchanged.
- [x] Test the kind route and executor workspace binding.

## Deployment repository and release gates

- [ ] Implement and mount the issuer-allowlisted APISIX verifier with bounded JWKS cache.
- [ ] Render chart route 2006 with the same verifier and executor upstream; provide the explicit realm configuration and keep 2006-key unchanged.
- [ ] Verify chart and kind route parity, gateway authentication failures, and bearer Mongo document round trip.
- [ ] Update the staging standalone ConfigMap only through the operator-gated release process and record its SHA.
