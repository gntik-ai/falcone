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
evidence for falcone-charts commit `1f259abf0de70a77a01a73a40c5c0d1bb707b8f0` (passing delivery and
selector tests, reuse-values render and Helm lint). The same review found that neither the target
Secret nor the OpenBao signer record is bootstrapped. Fresh-install/upgrade key provisioning and
readiness remain a required companion deployment fix. This source follow-up restores the skipped
CI ExternalSecret but does not claim chart key provisioning or cluster acceptance.
