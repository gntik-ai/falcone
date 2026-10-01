## Source repository

- [x] Point kind route 2006 at the executor with the host-scoped verifier schema and preserve route 2006-key.
- [x] Require `issuer-jwks-auth` for public-api-mongo in the gateway-policy package and contract while other product routes retain `openid-connect`.
- [x] Cover route policy, chart/kind parity, kind pod wiring, executor workspace rejection, and a live kind bearer document round trip.
- [x] Record the revised operator decision and a requirements delta.
- [x] Require chart/kind route parity in normal PR CI, trigger the live kind gate for authentication test changes, and cover rejected policy regressions and signed tenant-realm identity derivation.
- [x] Align both CI workflow chart pins with deployment HEAD `bb3284bf992a05d1c85149a1115982321fc2f2e5`, including reuse of the configured APISIX image for the config-overlay init container.

## Deployment repository and release gates

- [x] Complete the host-scoped APISIX verifier with realm validation, platform-only audience enforcement, bounded JWKS cache, fetch load protection, and failure-path Lua tests.
- [x] Render route 2006 and executor issuer/JWKS settings from environment values; verify staging and prod renders contain no dev issuer.
- [x] Mount the verifier Lua file and APISIX config overlay in kind; pass the source kind pod wiring test.
- [x] Render the staging standalone ConfigMap from canonical routes and compare it with the fixture derived from base kind routes plus the #980 delta. This fixture is not a captured live ConfigMap and contains no staging workaround route.
- [ ] Run the chart render-equality and Lua verifier tests in PR CI, and pass the staging numeric-user and repair-gate contracts.
- [ ] Run the kind bearer round trip through public APISIX, including unauthenticated and foreign-issuer 401 checks.
- [ ] Record the live staging ConfigMap SHA256, review the diff, then perform the operator-gated sync and post-rollout verification, including APISIX metrics and a second executor-served data-plane family.

## Source worktree validation handoff

This source follow-up validates charts `bb3284bf992a05d1c85149a1115982321fc2f2e5`. Route/parity checks (4), executor JWT verifier tests (9), and deployment Mongo chart render checks (8) pass. Both workflow files parse as YAML and their immutable pins match that HEAD. The source spec directory permissions are now 0755 so independent checkers can inspect the working copy.

The four checker-reported deployment regressions reproduce in a scoped 50-second run: `tests/flow-audit-chart.test.mjs:66` has a stale prior-render hash, `tests/blackbox/managed-knative/managed-knative-contract.test.mjs:432` has a stale default-render hash, and `tests/blackbox/staging-infrastructure/revision23-numeric-user-forward-recovery-contract.test.mjs:139` and `:194` fail because the new init container also uses the APISIX image. The ChangeSet remains blocked on those deployment repairs; no deployment files were modified by this source assignment.

Gateway-policy unit/contract checks are skipped pending installation of existing repository dependencies: the attempted run fails to import `yaml`, and `node_modules` is absent. Executor server identity checks are skipped because sandbox loopback binding returns `listen EPERM`; all five cases cancel before execution. Lua verifier checks need Lua, and the live kind round trip needs kind, container images, and the CI cluster. These checks remain required in PR CI and the release gate. No dependency manifest or lockfile changes are required.

## Deployment checker follow-up

- [x] Remove the unpinned BusyBox default from the config-overlay init container: deployment `bb3284bf` reuses the configured APISIX image, including its digest when set. The pre-existing default/prod APISIX image tag remains unchanged.
- [x] Replace the obsolete explicit issuer allow-list comment in deployment values with the host-scoped realm policy (deployment `bb3284bf`).
- [ ] Repair the four deployment `bb3284bf` contract regressions: re-baseline the reviewed default render and flow-audit prior render, and make the numeric-user contract and OpenShift overlay account for the APISIX config-overlay init container. These deployment files are outside this source-only assignment. After the repair commit, update both source CI pins together and repeat parity validation.
- [ ] Evaluate a rate-limited JWKS refresh on unknown `kid`; currently a rotated key may be rejected until the 300-second cache TTL expires.
- [ ] Confirm staging/prod public issuer and in-cluster JWKS URLs and executor egress with the deployment owner, and capture the actual live staging ConfigMap SHA256 before sync.
