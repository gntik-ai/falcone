# Source implementation and paired deployment handoff

## Source scope

- [x] Verify clean assigned source worktree on
  `agent/falcone/1053/98345e77-680f-56ce-bbb1-390a72484290`, starting at
  `baeec03855e44d83164343daa9b939fa03d8efa8`.
- [x] Add proposal, tasks and deployment-packaging spec delta for #1053.
- [x] Preserve source runtime, workflows, dependencies, lockfiles and fixtures.
- [x] Validate this change with OpenSpec strict mode and run the existing
  `tests/blackbox/mongo-gateway-route.test.mjs`; record bounded results below.
- [x] Review existing source HEAD
  `39bf53486a541ddd423ef16051687863ab7f68a9` on the same clean assigned branch;
  retain the previous implementation and Hermes pin commit.
- [x] Clarify the TLS semantics contract and hand off the deployment checker
  findings without modifying the separately assigned deployment worktree.

## Deployment maker and platform scope

- [ ] Choose one mechanism with evidence for Helm 3 client-side upgrade,
  Argo-style client-side apply of a Helm-created object without a last-applied
  record, and Helm 4 server-side apply as used by the harness. Record which
  paths fail and succeed; justify the choice from those results.
- [ ] Test renders at `433be51` and the target revision for default, staging,
  prod, prod-TLS and kind-TLS layers. Require exactly one entry per JWT env name,
  `valueFrom` only, and reject any env entry carrying both fields. Fix the
  prod-TLS duplicate if the check fails without changing JWT config semantics.
- [ ] Repair the checker-confirmed TLS regression in the deployment worktree:
  preserve the previous effective HTTPS JWKS endpoint through the executor
  ConfigMap source without changing the gateway verifier. Add resolved URL
  assertions for scheme, host, port and path against deployment base
  `93ee9371fdbd029ff49909ff1fb5c03eeff0ddae` for prod-TLS and kind-TLS.
  Uniqueness and CA env checks alone do not cover this regression.
- [ ] Correct TLS overlay guidance and unpublished release notes that claim
  the repair changes no ConfigMap values. Document preservation of the
  effective TLS endpoint and verify it in the prod checklist.
- [ ] Reproduce the API server's nonempty-value/valueFrom rejection on at
  least one untreated path, then prove the chosen migration succeeds, rolls
  out Available, and is idempotent on an already-migrated Deployment.
- [ ] Prove the ConfigMap exists before new pods start and the migration
  atomically supplies references for all five vars without a pod missing
  JWKS URL, issuer or audience. Verify live replicas and managed annotations.
- [ ] Use disposable kind or a live server-side dry-run for API validation;
  live cases may self-skip locally but must run in deployment CI. Never use
  shared clusters, kubeconfigs or Secret values; retain redacted evidence.
- [ ] Add notes to the next unpublished chart version and the prod checklist
  in `charts/in-falcone/docs/mongo-bearer-route-980-handoff.md`. Put audience
  reconciliation before enforcement and confirm real prod issuer/JWKS hosts
  before migration; include target revision/values, verification and rollback.
- [ ] If choosing an Argo sync-option, limit it to the executor Deployment,
  update and pass `deploy/argocd/README.md` equivalence, and document/test the
  Helm equivalent. Never force the whole Helm release.
- [ ] Run deployment upgrade regression, strict Helm lint for default,
  staging, prod and kind, and
  `tests/blackbox/staging-infrastructure/mongo-bearer-route-chart.test.mjs`.
  Preserve render baselines unless the mechanism requires an explained change.
- [ ] Hermes synchronizes both `FALCONE_CHARTS_REF` pins to the final deployment
  HEAD; rerun source Mongo route parity after synchronization.

## Bounded source validation (follow-up review)

The paired checkout on this review is
`700bc42123d02ae1fc558275ab47b630136d8dde`; both managed workflow pins now
match it after the existing Hermes commit. The earlier 5/6 parity failure
against the initial deployment checkout is resolved. A subsequent deployment
repair will require Hermes to converge both pins again. No deployment files
are modified by this source maker. Deployment tasks above remain handoff
obligations, not completed source work or claims of live-cluster evidence.

- PASS: `timeout 45s openspec validate fix-1053-executor-env-upgrade-path
  --strict --no-interactive --json` validates the change with no findings.
- PASS: with `FALCONE_CHART_PATH` pointing to the
  assigned deployment chart, `timeout 60s node --test
  --experimental-test-isolation=none tests/blackbox/mongo-gateway-route.test.mjs`
  passes 6/6 tests, including both Helm renders and workflow pin parity against
  the paired checkout's HEAD above. Preserve that assertion; Hermes must
  synchronize the final repaired deployment pins and rerun it.
- PASS: `git diff --check` for the staged source change.
- SKIPPED: live deployment upgrade matrix and availability/idempotency checks
  belong to deployment CI. This source sandbox has no kind executable and
  permits no shared-cluster access; no live-cluster success is claimed here.

No dependency updates are needed. The repository ignores `/openspec/`; add
only these three explicitly requested files with `git add -f`, retaining
the ignore policy and all unrelated files. This handoff is committed locally
on the assigned branch without push, merge, deployment or credential access.
