## Source repository

- [x] Add control-plane Ed25519 signing and runtime verification before source evaluation.
- [x] Preserve verified caller context and reject missing, forged, expired and wrong-target credentials.
- [x] Label function pod templates and inject public-only key rings and target identity.
- [x] Preserve ownership checks and document idempotent PATCH re-rolls and key overlap rotation.
- [x] Add scoped signer/verifier, runtime listener, manifest, lifecycle and naming tests.
- [x] Allow three seconds of issuance-time clock skew without extending expiry or credential lifetime.
- [x] Return a clear 400 for reserved workspace-secret env mappings and document existing-function migration.
- [x] Reserve only runtime, invocation and Node configuration names; preserve unrelated FN_* secret mappings.
- [x] Apply the function signer ExternalSecret in phased CI through the existing OpenBao/ESO readiness gates.
- [x] Use the test runner's Node binary in the isolated e2e harness, including installations outside /usr/bin.

## Companion deployment repository and release gates

- [x] Seed control-plane-only signing material in OpenBao idempotently on fresh install and upgrade, preserving existing keys.
- [x] Define an ESO signer Secret lifecycle that survives managed-ESO hook replacement and add an upgrade render test; rerun the test in companion PR CI.
- [x] Wire all three invocation env vars in the control-plane chart, with reuse-values-safe defaults and render tests excluding signing material from function workloads.
- [x] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [x] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Publish the enforcing fn-runtime image and pin its immutable digest; the pre-change 0.3.0 tag is insufficient.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.

Completed chart seeding, wiring, policy and selector tasks reflect the supplied independent
checker evidence for falcone-charts commit `c1bad265f62236cc24d20c418d40875c729c9e51`
(passing bootstrap and secret-delivery tests, selector tests, reuse-values render and Helm lint).
OpenBao seeds the absent signer record and preserves existing signing material. Source review of
the currently pinned companion chart `7c9b5f276fe2ed7ced1e6f06eb37fe18d82f5c62` confirms the signer
ExternalSecret now uses `creationPolicy: Orphan` and `deletionPolicy: Retain`. The companion
`tests/function-invocation-secret-delivery.test.mjs` asserts that lifecycle on managed-ESO upgrade
renders. This closes the stale implementation task, without claiming the companion test was run
in this source sandbox or that a live upgrade was verified. The source CI ExternalSecret readiness
wait remains mandatory; optional env references still require reconciliation before rollout on
fresh installs. Cluster acceptance and independent verification remain open.

Current source follow-up validation: the invocation-auth, lifecycle-ownership, cleanup-ownership,
caller-context, signed namespacing, deploy tenant-scope, mutation authorization, runtime
availability, input binding, rollback and public contract test files pass under a 30-second bound.
The full namespace-preservation harness also passed. No additional authentication defect was
reproduced. Three caller-context HTTP cases skipped because localhost listeners are forbidden;
request-listener authentication unit tests passed without sockets. Repository structure validation
and shell syntax checks passed. This follow-up changes only the task record and operations guide; no dependency or
workflow pin changes are needed.

The reported Analyze jobs, quality, real-stack and web-console failures cannot be attributed from
job names without CI logs. Local quality checks lack npm and installed dependencies; the
service-catalog test lacks yaml and public-API validation lacks swagger-parser; web-console lacks installed dependencies and pnpm's Node
subprocess was denied. Real-stack/image checks require an accessible Docker daemon and images,
and CodeQL is unavailable. These checks remain required in PR CI, alongside companion chart
lifecycle tests. The operations guide records the exact commands and limits. Policy-enforcing
cluster acceptance and independent verification remain release gates.
