## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.
- [x] Require chart/kind route parity in normal PR CI, trigger the live kind gate for authentication test changes, and cover rejected policy regressions and signed tenant-realm identity derivation.
- [x] Align both CI workflow chart pins with deployment HEAD `89461b2d0b2ce41684e9199317268912b71e2d7a`, including shared executor/verifier configuration and malformed-JWKS rejection.

## Deployment repository and release gates

- [x] Complete the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, fetch load protection, and failure-path Lua tests.
- [x] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [x] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [x] Render the staging standalone ConfigMap from canonical routes and compare it with the fixture derived from base kind routes plus the #980 delta. This fixture is not a captured live ConfigMap and contains no staging workaround route.
- [ ] Run the chart render-equality and Lua verifier tests in PR CI, and pass the staging numeric-user and repair-gate contracts.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification, including APISIX metrics and a second executor-served data-plane family.

## Source worktree validation handoff

Route/parity checks (4), executor JWT verifier tests (9), and deployment Mongo chart render checks (7) pass against charts `89461b2d0b2ce41684e9199317268912b71e2d7a`. Both workflow files parse as YAML and their immutable pins match that HEAD. Gateway-policy unit/contract checks require installed repository dependencies (`yaml`, `cel-js`, and `ajv` are absent); executor server identity checks cannot run because sandbox loopback binding returns `listen EPERM`. Lua verifier checks need Lua, and the live kind round trip needs the CI cluster and disposable client. These checks remain required in PR CI and the release gate.

The independent checker passed the staging infrastructure contract (14/14). This source follow-up reran it within a 50-second suite bound: 13/14 pass, with the rendered OpenBao reconciler shell-syntax subprocess timing out at its existing 30-second bound. Recheck that contract in PR CI; it is not recorded as passing in this invocation.

## Deployment checker follow-up

- [ ] Pin the new default APISIX config-overlay init-container image by digest in the deployment repository; staging already uses `docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`. This immutable-image violation remains a release blocker outside this source-only assignment. After that chart commit, update both source CI pins together to the final deployment revision and repeat parity validation.
- [ ] Replace the obsolete explicit issuer allow-list comment in deployment values with the host-scoped realm policy.
- [ ] Evaluate a rate-limited JWKS refresh on unknown `kid`; currently a rotated key may be rejected until the 300-second cache TTL expires.
- [ ] Confirm staging/prod public issuer and in-cluster JWKS URLs and executor egress with the deployment owner, and capture the actual live staging ConfigMap SHA256 before sync.
