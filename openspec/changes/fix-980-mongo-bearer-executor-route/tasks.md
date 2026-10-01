## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.
- [x] Require chart/kind route parity in normal PR CI, trigger the live kind gate for authentication test changes, and cover rejected policy regressions and signed tenant-realm identity derivation.
- [x] Pin state: **aligned with final deployment head**. Both CI workflow chart pins select `05bfc41d9095717cff1e33a5c16f2bc3cfe2d855`; source/chart parity passes against that head. This supersedes the preceding "pin pending deployment repair" handoff.

## Deployment repository and release gates

- [x] Complete the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, fetch load protection, and failure-path Lua tests.
- [x] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [x] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [x] Render the staging standalone ConfigMap from canonical routes and compare it with the fixture derived from base kind routes plus the #980 delta. This fixture is not a captured live ConfigMap and contains no staging workaround route.
- [ ] Run the chart render-equality and Lua verifier tests in PR CI, and pass the staging numeric-user and repair-gate contracts.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification, including APISIX metrics and a second executor-served data-plane family.

## Source worktree validation handoff

This source follow-up starts at source `48502c41cb12c4e92cc7c03616b80d807336430b` on assigned branch `agent/falcone/980/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6`, with a clean working tree and the supplied worktree identity. The assigned deployment worktree is also clean at final head `05bfc41d9095717cff1e33a5c16f2bc3cfe2d855`. Its handoff confirms the BusyBox and staging issuer repairs are complete. Both source workflow pins now select that head; no deployment files are modified in this source-only follow-up.

Scoped validation passes: `tests/blackbox/mongo-gateway-route.test.mjs` passes against the final deployment worktree (bounded by 55 seconds), and `tests/unit/control-plane-jwt-verify.test.mjs` passes (bounded by 30 seconds). The kind and chart standalone route files remain byte-identical; route 2006 reaches the executor with `issuer-jwks-auth`, identity-header removal/rejection and Secret-backed gateway trust. Workflow pin assertions and comparison of route 2006-key with source base `3a7306f20454db8a90f95a93a4049305efd1bce1` pass. This follow-up changes only the two pins and source OpenSpec records, preserving the previous implementation.

The independent checker confirms the deployment repair passes strict Helm lint for all four profiles, Mongo render checks, flow-audit and managed-Knative baselines, and APISIX numeric-identity/OpenShift assertions. Those deployment checks are checker evidence, not reruns by this source maker. For clarity, the reviewed fixture changes relative to deployment base/main `433be510` are umbrella SHA256 `b18179ef33e096050c236aee0efc87c886f63ceaf06bc61269c4370225d5c15c` to `b19843c58df41783469ca6655a5d160bc458488de4089dc4bb05839f29715588`, and flow-audit prior baseline `26c5dc19ecbb5054fc3a8565852c89def7f2456793010fe320d0fa046e56087b` to `3abc15a2691fc8839c74640770b23771c2d27f001e663fb319ea0543ea7a8b08`. The deployment handoff's "from" hashes refer to the intermediate attempt. The umbrella changes cover the verifier config/mounts and the separately pinned BusyBox overlay with preserved main identities; the flow-audit fixture hashes that same default render after removing flow-audit objects, bundled rule loading and the rollout marker, without changing flow-audit behavior. No source fixture is re-baselined.

Gateway-policy unit, gateway-policy contract and API-key contract checks are skipped pending installation of existing repository dependencies: the bounded command cannot import `yaml`, and `node_modules` is absent. Executor server identity checks remain skipped based on the previous attempt's sandbox `listen EPERM` on loopback. Live kind CRUD/isolation/API-key and image/network checks require CI infrastructure unavailable here; Lua verifier checks need Lua or LuaJIT, neither installed here. All these checks, plus the full staging-infrastructure contract including shell syntax and package-pull repair checks, remain required in PR CI and the release gate. No dependency manifest or lockfile changes are required.

## Deployment checker follow-up

- [x] Deployment `05bfc41d` uses `docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0` for the config-overlay init container in default, prod, kind and staging. The checker confirms APISIX numeric identities and OpenShift contracts equal main; deployment render tests cover the separate image.
- [x] Replace the obsolete explicit issuer allow-list comment in deployment values with the host-scoped realm policy (deployment `bb3284bf`).
- [x] Deployment `05bfc41d` repairs the reviewed image/identity and fixture regressions. Only the umbrella default render SHA256 and flow-audit prior-render baseline are re-baselined, with justification in the deployment handoff and base-relative hashes above. Both source pins now select this repair, and parity passes.
- [x] Deployment `05bfc41d` sets staging `global.keycloakIssuerBaseUrl` to `https://iam.baas.musematic.ai`, retaining JWKS base `http://falcone-keycloak:8080`; the checker confirms executor `KEYCLOAK_ISSUER` equals `https://iam.baas.musematic.ai/realms/in-falcone-platform`. Prod keeps documented operator-supplied placeholder hosts. Staging issuer, standalone parity and kind plugin-mount checks pass.
- [ ] Release review only (outside this ChangeSet): evaluate a rate-limited JWKS refresh on unknown `kid`; currently a rotated key may be rejected until the 300-second cache TTL expires.
- [ ] Release review: confirm the live staging token issuer, obtain prod hosts, confirm executor egress, and capture the actual live staging ConfigMap SHA256 before sync. The repaired staging render URLs are already verified by the checker.
- [ ] Release review: confirm platform-only audience enforcement is the intended reading of the wrong-audience acceptance criterion; tenant tokens use realm issuer trust per the source spec and executor verifier.
- [ ] Release follow-up: assess a per-subject rate-limit key, since rejected identity headers leave bearer requests sharing the client-IP bucket; retain current 429 behavior in this ChangeSet.
- [ ] Release review: note the bounded body caps (bootstrap Mongo route 262144 bytes, standalone/kind 1048576 bytes) and decide whether airgap values and mirror lists need the literal BusyBox digest added. No opportunistic policy or image-list changes are made here.
