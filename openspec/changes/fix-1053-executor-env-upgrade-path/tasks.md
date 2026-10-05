# Source implementation and paired deployment handoff

## Source scope

- [x] Verify the clean assigned worktree and branch
  `agent/falcone/1053/98345e77-680f-56ce-bbb1-390a72484290` at expected HEAD
  `6d21b9de062b08e5e9c4b2bbff58bea6cbfbd928`, retaining all previous commits
  on base `baeec03855e44d83164343daa9b939fa03d8efa8`.
- [x] Review the previous proposal, tasks and deployment-packaging spec delta.
- [x] Add the checker findings to the bounded deployment contract: Helm 4
  retry ownership, existing #980 TLS duplicate upgrades, actual path evidence,
  helper prerequisites and shipping-version review.
- [x] Preserve source runtime, dependencies, lockfiles and fixtures; leave
  Hermes-managed workflow pins untouched.
- [x] Run strict OpenSpec validation and the source Mongo route parity gate.
- [x] Persist the remaining deployment obligations below in this source handoff.

## Deployment maker and platform scope

The paired deployment checkout is clean at
`f929e895851c1c689017d0eaf15ae83670e13a7a`. The source maker has read only the
bounded test context needed to assess the supplied checker finding. No files
in that separately assigned deployment worktree are modified here.

- [ ] Fix the blocking Helm 4 retry in
  `tests/blackbox/deployment-packaging/executor-env-upgrade.py:333` and `:412`.
  The probe declares one replica, while the external kubectl patch at `:388`
  sets two; retrying server-side delivery can conflict on `spec.replicas`.
  Exclude externally managed replicas from the applied probe manifest or use
  another tested ownership-preserving procedure. Keep the external-manager
  preservation assertions, and separately test/document handling HPA replica
  conflicts. Do not force conflicts across the release. An expected conflict
  alone cannot satisfy successful delivery after the env migration.
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
- [ ] Test/document upgrading existing #980 prod-TLS and kind-TLS releases
  from `93ee9371` plus `deploy/kind/values-production.yaml`, whose executor
  has duplicate JWKS names. Prove the atomic step retains exactly one of each
  of the five references and the effective HTTPS endpoint, reaches Available,
  and is repeatable. Do not assume a merge removes only one duplicate.
- [ ] List Python 3 with PyYAML, Helm and kubectl in the operator prerequisites
  for `charts/in-falcone/migrations/executor-jwt-env-upgrade.py`.
- [ ] Obtain release-review acknowledgement of the stored TLS JWKS ConfigMap
  representation change that preserves the effective HTTPS 8443 endpoint,
  without changing gateway verification. Confirm which unpublished chart
  version ships #980: notes currently name 0.4.20 while Chart.yaml is 0.4.19.
  Do not edit published notes/packages.
- [ ] Retain the prior TLS endpoint and reused-values regression contracts.
  The supplied independent checker reports those earlier repairs implemented
  and offline gates passing at the paired HEAD; they are no longer recorded
  here as current failures. Preserve effective JWT config from deployment
  base `93ee9371fdbd029ff49909ff1fb5c03eeff0ddae` and inherited `433be51` values.
- [ ] Retain release prerequisites: audience reconciliation before enforcement,
  real prod issuer/JWKS hosts, exact target revision/ordered values, target JWT
  ConfigMap readiness, bounded verification and executor-only rollback.
- [ ] Run the deployment upgrade regression, required strict Helm lint profiles,
  Mongo bearer chart regression and Argo README equivalence check. Preserve
  all migration, backup, evidence, immutable-image and External Secrets gates.
- [ ] Hermes synchronizes both source workflow pins after the deployment repair
  and reruns source Mongo route parity against the final deployment HEAD.

## Bounded source validation (current follow-up review)

The paired checkout and both existing source pins match
`f929e895851c1c689017d0eaf15ae83670e13a7a`. A subsequent deployment repair
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
  them passing at this paired HEAD; they must remain passing after its repair.

No dependency updates are needed. The repository ignores `/openspec/`; add
only these three explicitly requested files with `git add -f`, retaining the
ignore policy. Commit the source follow-up locally on the assigned branch
without push, merge, deployment, shared-cluster access or credential access.
