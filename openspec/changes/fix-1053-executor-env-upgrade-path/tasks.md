# Source implementation and paired deployment handoff

## Source scope

- [x] Verify the clean assigned worktree and branch
  `agent/falcone/1053/98345e77-680f-56ce-bbb1-390a72484290` at expected HEAD
  `88c7ff948903a74ee4ddc9240297fe8d8f4ceb06`, retaining all previous commits
  on base `baeec03855e44d83164343daa9b939fa03d8efa8`.
- [x] Review the previous proposal, tasks and deployment-packaging spec delta.
- [x] Strengthen the deployment contract for the two blocking checker findings:
  ConfigMap preparation and atomic migration before executor delivery, matching
  live/target ConfigMap data, fake-client mismatch rejection and live assertions
  over every newly created ReplicaSet template. Retain the effective TLS endpoint.
- [x] Refresh this handoff against the current paired HEAD, closing implemented
  Helm 4 replica-ownership, helper-prerequisite and TLS starting-state coverage
  tasks without claiming pending live evidence or the new blockers are resolved.
- [x] Preserve source runtime, dependencies, lockfiles and fixtures; leave
  Hermes-managed workflow pins untouched.
- [x] Run strict OpenSpec validation and the source Mongo route parity gate.
- [x] Persist the remaining deployment obligations below in this source handoff.

## Deployment maker and platform scope

The paired deployment checkout is clean at
`2dac50ecb0a39ab01d93ce28acde03c4911faf16`. The source maker has read only the
bounded helper, test and rollout context needed to assess the checker findings.
The two blocking deployment findings remain present at that HEAD. No files
in that separately assigned deployment worktree are modified here.

- [ ] BLOCKING: change the release notes and prod checklist from delivery-then-
  repair to gated target ConfigMap preparation, atomic env migration, then target
  executor Deployment delivery. Preparation must not submit the unsafe executor
  template. Cover pre-#980 literals and existing #980 prod-TLS/kind-TLS duplicates.
  Check every executor ReplicaSet created during the positive live sequence for
  required JWKS/issuer/audience, duplicate JWT names and dual-field env; check all
  five references after migration. Keep untreated negative experiments separate.
  `ACCEPTED_INVALID_JWT_ENV` may describe an isolated untreated experiment but
  must never be an allowed outcome in the successful operator sequence.
- [ ] BLOCKING: replace the helper's nonempty-key-only ConfigMap readiness gate
  with an in-process comparison of live data to the ConfigMap from the exact
  target chart revision and ordered values render. Missing, empty or mismatched
  data must fail before any patch/rollout, on dry-run, apply and already-migrated
  no-op paths. Add a fake-client case with all keys present but stale HTTP JWKS
  data proving zero mutations. Never print ConfigMap data or read Secret values.
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
  positive live safety assertions to both profiles as required by the blockers
  above; current final-state checks do not prove intermediate templates are safe.
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
- [ ] Retain release prerequisites: audience reconciliation before enforcement,
  real prod issuer/JWKS hosts, exact target revision/ordered values, target JWT
  ConfigMap data equality before atomic migration and target executor delivery,
  bounded verification and executor-only rollback.
- [ ] Tolerate or document HPA scaling during the helper's rollout wait. Its
  current before/after replica comparison can report a post-patch failure when
  the HPA scales independently. Never imply that such a failure undoes the env
  patch or reset replicas owned by the HPA.
- [ ] Run the deployment upgrade regression, required strict Helm lint profiles,
  Mongo bearer chart regression and Argo README equivalence check. Preserve
  all migration, backup, evidence, immutable-image and External Secrets gates.
- [ ] Hermes synchronizes both source workflow pins after the deployment repair
  and reruns source Mongo route parity against the final deployment HEAD.

## Bounded source validation (current follow-up review)

The paired checkout and both existing source pins match
`2dac50ecb0a39ab01d93ce28acde03c4911faf16`. A subsequent deployment repair
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
  deployment CI. Kind is absent here; no live-cluster success is claimed.
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
