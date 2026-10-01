## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.

## Deployment repository and release gates

- [ ] Implement the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, and failure-path Lua tests.
- [ ] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [ ] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [ ] Render the staging standalone ConfigMap from canonical routes and compare it with a recorded live baseline plus the #980 delta.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification.
