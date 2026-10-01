## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.
- [x] Require chart/kind route parity in normal PR CI, trigger the live kind gate for authentication test changes, and cover rejected policy regressions and signed tenant-realm identity derivation.
- [ ] After the deployment repair is complete and verified, align both CI workflow chart pins with its final reviewed HEAD and repeat parity. Both currently pin `bb3284bf992a05d1c85149a1115982321fc2f2e5`, which matches the assigned deployment HEAD but violates operator addenda 8 and 10.

## Deployment repository and release gates

- [x] Complete the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, fetch load protection, and failure-path Lua tests.
- [x] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [x] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [x] Render the staging standalone ConfigMap from canonical routes and compare it with the fixture derived from base kind routes plus the #980 delta. This fixture is not a captured live ConfigMap and contains no staging workaround route.
- [ ] Run the chart render-equality and Lua verifier tests in PR CI, and pass the staging numeric-user and repair-gate contracts.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification, including APISIX metrics and a second executor-served data-plane family.

## Source worktree validation handoff

This source follow-up starts at source `cc930ffa18950b59a31c0c0a84e8ac7d6832cec9` on the assigned issue-980 branch with a clean working tree. The assigned deployment worktree is also clean and remains at `bb3284bf992a05d1c85149a1115982321fc2f2e5`. Both source workflow pins already match that HEAD, so the checker's earlier pin mismatch is resolved. That HEAD is not the required repaired deployment revision: default/prod/kind still reuse the APISIX image and staging still sets `global.keycloakIssuerBaseUrl` to `https://iam.baas.musematic.ai/auth`.

The source Mongo route/parity and executor JWT verifier test files pass against that deployment worktree. These checks do not establish compliance with the revised overlay image or staging issuer requirements. No deployment files or workflow pins were modified in this source-only assignment; the final pin update is gated on completing and verifying the deployment repairs first.

Scoped chart checks, bounded by `timeout 55s` and restricted to the four reported test names, fail in all three affected test files. The checker identifies a stale prior-render hash at `tests/flow-audit-chart.test.mjs:66`, a stale default-render hash at `tests/blackbox/managed-knative/managed-knative-contract.test.mjs:432`, and two numeric-user/OpenShift failures at `tests/blackbox/staging-infrastructure/revision23-numeric-user-forward-recovery-contract.test.mjs:139` and `:194` caused by the init container also using the APISIX image. The ChangeSet remains blocked on those deployment repairs.

Gateway-policy unit/API-key contract checks are skipped pending installation of existing repository dependencies: the attempted run fails to import `yaml`, and `node_modules` is absent. The prior source attempt's executor server identity checks were skipped because sandbox loopback binding returned `listen EPERM`; all five cases cancelled before execution. Lua verifier checks need Lua, and the live kind round trip needs kind, container images, and the CI cluster. These checks remain required in PR CI and the release gate. No dependency manifest or lockfile changes are required.

## Deployment checker follow-up

- [ ] Use `docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0` for the config-overlay init container in default, prod, kind and staging. Deployment `bb3284bf` reuses APISIX in default/prod/kind, contrary to operator addendum 8. Preserve the main pod/container security contexts, `IfNotPresent`, dropped `ALL` capabilities and disabled privilege escalation; update the tests that currently require APISIX image reuse.
- [x] Replace the obsolete explicit issuer allow-list comment in deployment values with the host-scoped realm policy (deployment `bb3284bf`).
- [ ] Repair the four deployment `bb3284bf` contract regressions by using the separate pinned BusyBox image, preserving main's numeric identities and OpenShift overlay contracts. Re-baseline only the umbrella default render SHA256 and flow-audit prior-render baseline, and justify each change in the deployment handoff. These deployment files are outside this source-only assignment. After the verified repair commit, update both source CI pins together and repeat parity validation.
- [ ] Set staging `global.keycloakIssuerBaseUrl` to `https://iam.baas.musematic.ai`, retaining JWKS base `http://falcone-keycloak:8080`, and assert rendered executor `KEYCLOAK_ISSUER` equals `https://iam.baas.musematic.ai/realms/in-falcone-platform`. Prod keeps documented operator-supplied placeholder hosts. Update staging issuer tests; retain standalone route parity and plugin-mount coverage.
- [ ] Evaluate a rate-limited JWKS refresh on unknown `kid`; currently a rotated key may be rejected until the 300-second cache TTL expires.
- [ ] Confirm staging/prod public issuer and in-cluster JWKS URLs and executor egress with the deployment owner, and capture the actual live staging ConfigMap SHA256 before sync.
