## Source checker repair handoff (2026-10-01)

This follow-up starts from supplied source HEAD `0bef4812d34853f3ddf2492dc6ed3dd37f455ffd` in the clean assigned worktree on branch `agent/falcone/980/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6`. Git worktree metadata matches the assigned lease path. The deployment worktree is clean at final ChangeSet head `ef5a926bcfadf3a2e6d9136dd44bda1db221eca6`. This consolidated record supersedes the earlier pending and completed pin records.

## Completed source work

- [x] Route 2006 reaches the executor through `issuer-jwks-auth`, preserving identity-header rejection/removal, Secret-backed gateway trust, body caps, correlation and 429 behavior. Bearer traffic strips `apikey` and `x-api-key`; canonical API-key traffic selects higher-priority 2006-key.
- [x] Preserve route 2006-key byte-for-byte against source base `3a7306f20454db8a90f95a93a4049305efd1bce1`.
- [x] Require the Mongo verifier in gateway-policy and reject restored OIDC there; other product routes retain OIDC.
- [x] Preserve the prior kind integration fixture and gate: workspace-bound tenant token, CRUD, cross-workspace denial, unauthenticated/foreign-issuer 401, API-key scope enforcement, mixed credentials and per-key 429. Execution remains a CI gate below.
- [x] Confirm deployment repair includes bearer API-key header removals in standalone routes and bootstrap values, and the corrected standalone comment. Source and chart canonical routes have identical SHA256 `b0f0dab91383adb32d6f4f5917e2093fda24758c8b18e7b00b132d2a298824f4`.
- [x] Pin state: **complete**. Both `.github/workflows/ci.yml` and `.github/workflows/integration.yml` select final deployment head `ef5a926bcfadf3a2e6d9136dd44bda1db221eca6`. Full source/chart route parity passes against that head; its deployment handoff's pending-source-pin record is superseded here. No additional deployment commit is needed.
- [x] Consolidate the superseded OpenSpec pin states. This follow-up changes only both workflow pins and the proposal/task records, preserving the prior implementation and safety gates.

## Bounded validation in this attempt

- PASS: `FALCONE_CHART_PATH=/srv/engineering/worktrees/falcone-charts/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6/charts/in-falcone timeout 55s node --test --experimental-test-isolation=none tests/blackbox/mongo-gateway-route.test.mjs tests/unit/control-plane-jwt-verify.test.mjs` (14/14). Includes rendered bootstrap policy/header parity, standalone byte equality, kind plugin mounts, signed tenant/workspace identity and executor JWT rejection checks.
- PASS, supplemental: `timeout 45s node --loader /tmp/falcone-980-readonly-loader.mjs --test --experimental-test-isolation=none tests/unit/gateway-policy.test.mjs tests/contracts/gateway-apikey-routes.contract.test.mjs` (14/14). The inspected read-only loader supplies installed toolchain YAML 2.9.1 and redirects existing chart-relative reads to the assigned deployment path; repository files and fixtures are unchanged.
- PASS: final deployment identity/cleanliness and both exact pins, parsed workflow YAML, Bash syntax for workflow run blocks, canonical route parity and unchanged API-key route against base. Workflow parsing uses installed toolchain YAML, not the absent frozen repository dependency.
- PASS: `git diff --check`.
- SKIPPED: native gateway-policy unit/API-key/full-policy contracts. The bounded native attempt cannot import existing `yaml`; the full contract also needs its existing `ajv`/`cel-js` import graph. PR CI must rerun with frozen repository dependencies. No dependency manifest or lockfile updates are needed.
- SKIPPED: live kind CRUD/isolation/API-key round trip requires Docker/network and a configured stack; LuaJIT verifier checks require an absent runtime. Full staging-infrastructure contract (including the previously timed-out shell-syntax subtest), image builds/scans and release gates require PR CI/release infrastructure. Executor HTTP identity tests remain deferred after the prior sandbox `listen EPERM`; this pin-only follow-up does not rerun them.

## Paired deployment evidence

The independent checker reports strict Helm lint and default/prod/staging/kind/airgap/OpenShift renders, Mongo and flow-audit checks, and unchanged APISIX numeric identities/OpenShift behavior. These are checker results, not reruns by this source maker. Deployment handoff `charts/in-falcone/docs/mongo-bearer-route-980-handoff.md` records the completed repairs and fixture justifications:

- BusyBox overlay digest `sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0` renders separately from APISIX in all profiles, including the airgap registry.
- Staging issuer base is `https://iam.baas.musematic.ai` without `/auth`; JWKS base is `http://falcone-keycloak:8080`. Prod retains documented placeholders.
- Staging renders one managed standalone ConfigMap with canonical routes and no `llmwiki-s2-mongo-jwt`; kind mounts the verifier and configuration.
- Only the umbrella default SHA256 and flow-audit baseline are re-baselined. Relative to deployment base `433be510`, umbrella changes `b18179ef33e096050c236aee0efc87c886f63ceaf06bc61269c4370225d5c15c` to `b19843c58df41783469ca6655a5d160bc458488de4089dc4bb05839f29715588`, reflecting verifier configuration/mounts and the separate BusyBox overlay with main identities preserved. Flow-audit changes `26c5dc19ecbb5054fc3a8565852c89def7f2456793010fe320d0fa046e56087b` to `3abc15a2691fc8839c74640770b23771c2d27f001e663fb319ea0543ea7a8b08`, hashing the same changed default render with flow-audit additions removed; flow-audit behavior is unchanged.
- Managed-ConfigMap, revision23 synthetic fixture and revision-20 mount/volume assertions implement adoption and plugin-mount requirements; they are not additional baseline refreshes. The handoff now justifies those adaptations and deployment CI now requires LuaJIT.

## Outstanding CI and release decisions

- [ ] Run frozen-dependency contracts, LuaJIT verifier failure/cache tests, the public kind round trip and full staging-infrastructure contract in PR CI; run image scans/builds and release gates on their required infrastructure.
- [ ] Product/security must decide tenant audience semantics before release. Current executor/verifier enforce audience only for the platform realm and accept a trusted tenant token with `aud: tenant-app`; the literal wrong-audience acceptance criterion remains unresolved.
- [ ] Track the inherited bearer shared-IP rate-limit bucket separately; behind a load balancer it may become a shared 120/min bucket. Preserve current 429 behavior here.
- [ ] Before operator-gated sync, confirm the live staging issuer, executor egress and prod hosts; retain the live standalone ConfigMap SHA256/diff and rollback content. The route fixture derives from base kind routes, not a captured live ConfigMap.
- [ ] Confirm the BusyBox digest exists in the airgap mirror inventory. Future default init-container changes must also update the airgap override list.
- [ ] Review unknown-kid refresh separately; the gateway currently fails closed until the bounded 300-second cache expires. Preserve existing bounded bootstrap/standalone body caps and track the inherited staging main-image policy separately.

No deployment, merge, push, credential retrieval, cluster mutation or source fixture re-baseline is part of this follow-up.
