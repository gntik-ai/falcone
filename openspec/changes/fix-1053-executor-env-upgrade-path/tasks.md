# Source implementation and paired deployment handoff

## Current source follow-up review (2026-10-05)

- [x] Verify the clean assigned worktree and branch
  `agent/falcone/1053/98345e77-680f-56ce-bbb1-390a72484290` at supplied starting
  HEAD `b7ce107133a8b15196cc58900aa4876dc0ba81d4`, retaining the existing
  ChangeSet commits on base `baeec03855e44d83164343daa9b939fa03d8efa8`.
- [x] Review the existing proposal, tasks and deployment-packaging spec delta.
  The source requirements are already implemented; no runtime, dependency,
  fixture or spec correction is needed for this follow-up.
- [x] Verify both Hermes-managed workflow pins match the clean paired deployment
  checkout at `75fef8f41b5542ca82380532af68058c13cbb0b9`; leave the pins untouched.
- [x] Run `timeout 45s openspec validate fix-1053-executor-env-upgrade-path
  --strict --no-interactive --json`: PASS, with no findings.
- [x] Run `FALCONE_CHART_PATH` set to the assigned deployment chart with
  `timeout 60s node --test --experimental-test-isolation=none
  tests/blackbox/mongo-gateway-route.test.mjs`: PASS, 6/6 with no skips,
  including both workflow pins and Helm render parity.
- [x] Refresh this source handoff without modifying the deployment worktree.

The supplied platform validation reports new findings only in the deployment
repository; those fixes belong to its assigned maker. The older review below
records the findings and evidence at `bc53eca`, not the current deployment
status. The paired checkout now contains follow-up evidence-serialization and
operator-procedure changes. This source review does not independently verify
those repairs or claim live upgrade success. Preserve all outstanding deployment
CI and release gates below. If the deployment maker produces another commit,
Hermes must reconverge both source pins and rerun Mongo route parity.

SKIPPED locally: the disposable-kind live upgrade matrix and its rollout,
pod-resolution and intermediate-ReplicaSet checks require kind, Helm 3 and
container images unavailable in this network-free sandbox. Deployment lint,
Argo equivalence and bootstrap regression checks remain with the deployment
maker and PR CI. These limitations do not block the completed source scope.
No dependency resolution is required.

## Previous source scope (historical review)

- [x] Verify the clean assigned worktree and branch
  `agent/falcone/1053/98345e77-680f-56ce-bbb1-390a72484290` at expected HEAD
  `da2ea11e9bf7c22118c113f07b54994ab14caa53`, retaining all previous commits
  on base `baeec03855e44d83164343daa9b939fa03d8efa8`.
- [x] Review the previous proposal, tasks and deployment-packaging spec delta.
- [x] Correct the operator contract to permit normal gated target delivery while
  only the executor is paused, followed by ConfigMap verification, atomic repair,
  any rejected-delivery retry and final verification/repair before resume. Require
  executable real-chart Helm and Argo procedures and preserve all existing gates.
- [x] Add an evidence-generation requirement covering the matrix's Helm 3
  variable-scope failure without claiming the deployment implementation is fixed.
- [x] Refresh this handoff against `bc53eca`, closing implemented safety and
  ConfigMap comparison tasks while retaining the two current deployment blockers.
- [x] Preserve source runtime, dependencies, lockfiles and fixtures; leave
  Hermes-managed workflow pins untouched.
- [x] Run strict OpenSpec validation and the source Mongo route parity gate.
- [x] Persist the remaining deployment obligations below in this source handoff.

## Previous deployment maker and platform scope (historical review)

The paired deployment checkout is clean at
`bc53eca0e0f99000a60646ebd5893640c728d7bf`. The source maker has read only the
bounded helper, test and rollout context needed to assess the checker findings.
The two blocking deployment findings remain present at that HEAD. No files
in that separately assigned deployment worktree are modified here.

- [x] Deployment commit `bc53eca` implements paused delivery, atomic repair
  before resume, isolated negative experiments and validation of every new
  executor ReplicaSet template. Retain those safety checks for pre-#980 literals
  and existing #980 TLS duplicates; live success remains pending CI.
- [x] Deployment commit `bc53eca` compares live ConfigMap data with the exact
  target render in-process, rejecting missing/empty/mismatched data before patch
  or rollout on dry-run/apply/no-op paths, with fake-client mismatch coverage.
- [ ] BLOCKING: resolve `helm3` from `HELM3_BIN` within `Live.matrix` or a
  shared scope in `tests/blackbox/deployment-packaging/executor-env-upgrade.py`.
  Its current evidence-writing call at line 509 cannot access `run_case`'s
  local variable at line 549. Cover completed-matrix evidence serialization
  offline and prove the mandatory CI upload receives the six-case JSON.
- [ ] BLOCKING: replace the release notes/checklist's unexecutable ConfigMap-only
  preparation with a tested real-chart Helm and Argo procedure: pause only the
  executor, run gated target delivery retaining the pause, verify target ConfigMap
  data, dry-run/apply atomic repair, retry rejected delivery while paused,
  reverify/repair, then resume. Test any rejection/rollback behavior without
  bypassing existing gates. Keep the helper's exact ConfigMap precondition;
  a probe chart retaining the old executor is not an operator preparation command.
- [x] Deployment commit `2dac50e` omits replicas from the live probe manifests,
  preserving simulated HPA ownership across Helm 4 retries, and documents
  executor-only replica alignment without forcing release-wide conflicts.
  Retain the existing ownership/annotation checks; actual live retries remain
  pending CI. A replicas conflict alone does not reproduce the env defect.
- [ ] Run the mandatory disposable-kind Helm 3 / Argo-client / Helm 4 matrix
  in deployment CI. Record untreated, atomic-step and retry outcomes separately,
  including at least one actual nonempty-value/valueFrom rejection. Prove
  rollout Available, pod reference resolution, ConfigMap-before-pod ordering,
  atomicity, preserved replicas/annotations and idempotency. Distinguish field
  ownership conflicts from the reported env validation failure.
- [ ] Before release, record all three paths' actual outcomes in the unpublished
  release notes and #980 prod handoff, cite the redacted evidence artifact ID
  and SHA256, and justify the chosen mechanism from those results. Do not
  substitute a pointer to a future CI artifact or invent outcomes locally.
- [x] Existing #980 TLS duplicate starting-state render/probe coverage and
  guidance are implemented at the paired HEAD. The live matrix covers prod-TLS;
  offline render contracts include kind-TLS. Retain those fixtures and extend
  real-chart procedure coverage to both profiles; the existing new-ReplicaSet
  assertions must remain enforced after the preparation change.
- [x] The unpublished notes and prod checklist list Python 3 with PyYAML, Helm
  and kubectl as prerequisites for the migration helper.
- [ ] Obtain release-review acknowledgement of the stored TLS JWKS ConfigMap
  representation change that preserves the effective HTTPS 8443 endpoint,
  without changing gateway verification. Confirm which unpublished chart
  version ships #980: notes currently name 0.4.20 while Chart.yaml is 0.4.19.
  Do not edit published notes/packages.
- [x] Retain the prior TLS endpoint and reused-values regression contracts.
  The supplied independent checker reports those earlier repairs implemented
  and offline gates passing at the paired HEAD; they are no longer recorded
  here as current failures. Preserve effective JWT config from deployment
  base `93ee9371fdbd029ff49909ff1fb5c03eeff0ddae` and inherited `433be51` values.
- [x] The current notes/checklist retain audience reconciliation before
  enforcement, real prod issuer/JWKS hosts, exact target revision/ordered values,
  ConfigMap data equality before atomic repair and executor-only rollback.
  Update their delivery ordering under the operability blocker above.
- [x] The current prod checklist documents HPA scaling during the helper wait
  as a possible post-patch verification failure, with bounded recovery that
  does not imply rollback of the patch or reset HPA-owned replicas.
- [ ] Run the deployment upgrade regression, required strict Helm lint profiles,
  Mongo bearer chart regression and Argo README equivalence check. Preserve
  all migration, backup, evidence, immutable-image and External Secrets gates.
- [x] Hermes synchronized both source workflow pins to the current deployment
  HEAD `bc53eca0e0f99000a60646ebd5893640c728d7bf` in source commit `da2ea11e`.
- [ ] Hermes synchronizes both pins again after the pending deployment repair
  and reruns source Mongo route parity against its final HEAD.

## Previous bounded source validation (historical review)

The paired checkout and both existing source pins match
`bc53eca0e0f99000a60646ebd5893640c728d7bf`. A subsequent deployment repair
requires Hermes to converge them again. Deployment obligations above remain
handoff items; this source commit does not establish live upgrade evidence.

- PASS: `timeout 45s openspec validate fix-1053-executor-env-upgrade-path
  --strict --no-interactive --json` validates with no findings.
- PASS: with `FALCONE_CHART_PATH` pointing to the assigned deployment chart,
  `timeout 60s node --test --experimental-test-isolation=none
  tests/blackbox/mongo-gateway-route.test.mjs` passes 6/6, including Helm renders
  and both pins matching the paired HEAD.
- PASS: `git diff --cached --check` for the source changes.
- SKIPPED: the live deployment matrix, rollout, pod resolution, existing #980
  TLS upgrade and Helm 4 ownership recovery require disposable kind and
  deployment CI. Kind and Helm 3 are absent here and image pulls need network;
  no live-cluster success is claimed.
- SKIPPED: deployment lint, equivalence and bootstrap checks are left to the
  separately assigned deployment maker and PR CI. The supplied checker reports
  lint and equivalence passing at this paired HEAD; they must remain passing
  after its repair. The locked-dependency `bbx-temporal-bootstrap-048` reuse-values
  check still needs PR CI: node_modules is absent and the checker's historical
  extraction attempt failed in the sandbox. No dependency changes are required
  for this source-only OpenSpec update.

No dependency updates are needed. The repository ignores `/openspec/`; add
only these three explicitly requested files with `git add -f`, retaining the
ignore policy. Commit the source follow-up locally on the assigned branch
without push, merge, deployment, shared-cluster access or credential access.
