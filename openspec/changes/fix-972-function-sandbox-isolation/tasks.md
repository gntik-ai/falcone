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

- [ ] Provision control-plane-only private signing material through External Secrets/OpenBao idempotently on fresh install and upgrade, without a Helm readiness deadlock.
- [x] Wire all three invocation env vars in the control-plane chart, with reuse-values-safe defaults and render tests excluding signing material from function workloads.
- [x] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [x] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Publish the enforcing fn-runtime image and pin its immutable digest; the pre-change 0.3.0 tag is insufficient.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.

Completed chart wiring, policy and selector tasks reflect the supplied independent checker
evidence for falcone-charts commit `ef47547ec77ef0f902d584f7bafe928627b6954a` (passing delivery and
selector tests, reuse-values render and Helm lint). That review found that the OpenBao signer
record is not seeded, so ESO cannot create its target Secret on a fresh install. Both blocking
findings require the companion OpenBao init Job to generate the absent record idempotently and
preserve existing signing material. The operations guide records the exact properties and
required companion tests. The source CI ExternalSecret readiness wait remains mandatory;
this source follow-up fixes the isolated test harness's Node lookup and does not claim chart
key provisioning or cluster acceptance.

Source follow-up validation: the 25 invocation-auth and lifecycle/ownership unit tests pass,
as do the caller-header tests, six signed namespacing cases and runtime Dockerfile COPY check.
Scoped harness tests pass for Helm 3/4 phased install, signer ESO ordering, eight readiness
failure gates and namespace preservation/cleanup. Three HTTP runtime blackbox cases require
local sockets unavailable here. The service-catalog validator needs the already-declared
`yaml` package installed in CI; the initial full namespace suite exceeded its 90-second
budget, so only the scoped harness cases are claimed. Image builds/scans and policy-enforcing
cluster acceptance remain CI/release gates.
