## Source repository

- [x] Add control-plane Ed25519 signing and runtime verification before source evaluation.
- [x] Preserve verified caller context and reject missing, forged, expired and wrong-target credentials.
- [x] Label function pod templates and inject public-only key rings and target identity.
- [x] Preserve ownership checks and document idempotent PATCH re-rolls and key overlap rotation.
- [x] Add scoped signer/verifier, runtime listener, manifest, lifecycle and naming tests.

## Companion deployment repository and release gates

- [ ] Provision control-plane-only private signing material through External Secrets/OpenBao.
- [ ] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [ ] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.
