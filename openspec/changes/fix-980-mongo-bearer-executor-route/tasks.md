## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.
- [x] Require chart/kind route parity in normal PR CI, trigger the live kind gate for authentication test changes, and cover rejected policy regressions and signed tenant-realm identity derivation.
- [ ] Pin state: **pin pending deployment repair**. After the deployment repair is complete and verified, align both CI workflow chart pins with its final reviewed HEAD and repeat parity. Both currently pin `bb3284bf992a05d1c85149a1115982321fc2f2e5`; keep them unchanged during this source-first attempt as operator addendum 9 requires.

## Deployment repository and release gates

- [x] Complete the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, fetch load protection, and failure-path Lua tests.
- [x] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [x] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [x] Render the staging standalone ConfigMap from canonical routes and compare it with the fixture derived from base kind routes plus the #980 delta. This fixture is not a captured live ConfigMap and contains no staging workaround route.
- [ ] Run the chart render-equality and Lua verifier tests in PR CI, and pass the staging numeric-user and repair-gate contracts.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification, including APISIX metrics and a second executor-served data-plane family.

## Source worktree validation handoff

This source follow-up starts at source `5d39640d2ed26d2b61c33a55c34cf2648cf17b4c` on assigned branch `agent/falcone/980/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6`, with a clean working tree and the supplied worktree identity. The assigned deployment worktree is also clean and remains at `bb3284bf992a05d1c85149a1115982321fc2f2e5`. Both source workflow pins match that intermediate HEAD, but the final pin remains pending: default/prod/kind still reuse the APISIX image and staging still sets `global.keycloakIssuerBaseUrl` to `https://iam.baas.musematic.ai/auth`.

Scoped validation passes: `tests/blackbox/mongo-gateway-route.test.mjs` has 4/4 passing cases against that deployment worktree (bounded by 55 seconds), and `tests/unit/control-plane-jwt-verify.test.mjs` has 9/9 passing cases (bounded by 30 seconds). The kind and chart standalone route files remain byte-identical; route 2006 reaches the executor with `issuer-jwks-auth`, identity-header removal/rejection and Secret-backed gateway trust, and route 2006-key remains unchanged from source base `3a7306f20454db8a90f95a93a4049305efd1bce1`. These checks do not establish compliance with the revised overlay image or staging issuer requirements. No deployment files or workflow pins were modified in this source-only assignment. Source review is complete for this attempt; **pin pending deployment repair** is the handoff to the deployment maker and the next source attempt.

The previous source attempt and independent checker report four deployment contract regressions: a stale prior-render hash at `tests/flow-audit-chart.test.mjs:66`, a stale default-render hash at `tests/blackbox/managed-knative/managed-knative-contract.test.mjs:432`, and two numeric-user/OpenShift failures at `tests/blackbox/staging-infrastructure/revision23-numeric-user-forward-recovery-contract.test.mjs:139` and `:194` caused by the init container also using the APISIX image. This source attempt does not rerun or repair those deployment-only tests. The deployment maker must repair them before the final source pin update; they do not block completion of the source-first assignment.

Gateway-policy unit, gateway-policy contract and API-key contract checks are skipped pending installation of existing repository dependencies: this attempt fails to import `yaml`, and `node_modules` is absent. Executor server identity checks are also skipped: this attempt reproduces sandbox `listen EPERM` on loopback, cancelling all five cases before execution. The live kind test explicitly skips with no CI cluster configuration; kind and container images are unavailable. Lua verifier checks need Lua or LuaJIT, neither installed here. All these checks, plus the full staging-infrastructure contract including shell syntax, remain required in PR CI and the release gate. No dependency manifest or lockfile changes are required.

## Deployment checker follow-up

- [ ] Use `docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0` for the config-overlay init container in default, prod, kind and staging. Deployment `bb3284bf` reuses APISIX in default/prod/kind, contrary to operator addendum 8. Preserve the main pod/container security contexts, `IfNotPresent`, dropped `ALL` capabilities and disabled privilege escalation; update the tests that currently require APISIX image reuse.
- [x] Replace the obsolete explicit issuer allow-list comment in deployment values with the host-scoped realm policy (deployment `bb3284bf`).
- [ ] Repair the four deployment `bb3284bf` contract regressions by using the separate pinned BusyBox image, preserving main's numeric identities and OpenShift overlay contracts. Re-baseline only the umbrella default render SHA256 and flow-audit prior-render baseline, and justify each change in the deployment handoff. These deployment files are outside this source-only assignment. After the verified repair commit, update both source CI pins together and repeat parity validation.
- [ ] Set staging `global.keycloakIssuerBaseUrl` to `https://iam.baas.musematic.ai`, retaining JWKS base `http://falcone-keycloak:8080`, and assert rendered executor `KEYCLOAK_ISSUER` equals `https://iam.baas.musematic.ai/realms/in-falcone-platform`. Prod keeps documented operator-supplied placeholder hosts. Update staging issuer tests; retain standalone route parity and plugin-mount coverage.
- [ ] Release review only (outside this ChangeSet): evaluate a rate-limited JWKS refresh on unknown `kid`; currently a rotated key may be rejected until the 300-second cache TTL expires.
- [ ] Verify the repaired staging render uses the operator-confirmed public issuer base `https://iam.baas.musematic.ai` and in-cluster JWKS base `http://falcone-keycloak:8080`. Obtain prod hosts from the operator, confirm executor egress, and capture the actual live staging ConfigMap SHA256 before sync.
